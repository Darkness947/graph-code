import { withTransaction } from '../../db/transaction.js';

/** Most unresolved imports returned with a graph (spec 7.6). */
export const UNRESOLVED_LIMIT = 200;

/** Deepest dependent the dependents query follows (spec 7.6). */
export const DEPENDENTS_MAX_DEPTH = 4;

/** Scopes every query to the signed-in user's repository (spec 7.6): `$1` repo id, `$2` user id. */
const OWNED = 'JOIN repositories r ON r.id = $1 AND r.user_id = $2';

/**
 * Graph data access (spec 7.6). Every method takes `userId` and returns nothing for a repository
 * the user does not own. Parameterized SQL only.
 * @param {import('pg').Pool} pool
 */
export function createGraphRepository(pool) {
  /**
   * Reads nodes, edges and unresolved imports from one snapshot, so a concurrent re-ingestion
   * can never produce edges that point at nodes missing from the same response.
   * @param {string} userId
   * @param {string} repoId
   * @returns {Promise<{ nodes: Record<string, any>[],
   *   edges: { id: number, source: string, target: string }[],
   *   unresolved: { count: number, items: { sourcePath: string, specifier: string, reason: string }[] } }>}
   */
  async function readGraph(userId, repoId) {
    const params = [repoId, userId];
    const [nodes, edges, unresolved] = await withTransaction(
      pool,
      async (client) => [
        await client.query(
          `SELECT n.id, n.path, n.name, n.node_type, n.language, n.size_bytes, n.metrics
           FROM nodes n ${OWNED} AND n.repository_id = r.id
           ORDER BY n.path`,
          params,
        ),
        await client.query(
          `SELECT e.id, e.source_node_id, e.target_node_id
           FROM edges e ${OWNED} AND e.repository_id = r.id
           ORDER BY e.id`,
          params,
        ),
        // The window count is computed before LIMIT, so it is the full total.
        await client.query(
          `SELECT n.path, u.raw_specifier, u.reason, COUNT(*) OVER () AS total
           FROM unresolved_imports u
           JOIN nodes n ON n.id = u.source_node_id
           ${OWNED} AND n.repository_id = r.id
           ORDER BY n.path, u.id
           LIMIT $3`,
          [...params, UNRESOLVED_LIMIT],
        ),
      ],
      'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY',
    );
    return {
      nodes: nodes.rows,
      edges: edges.rows.map((e) => ({
        // BIGINT arrives as a string; identity values stay far below 2^53.
        id: Number(e.id),
        source: e.source_node_id,
        target: e.target_node_id,
      })),
      unresolved: {
        count: Number(unresolved.rows[0]?.total ?? 0),
        items: unresolved.rows.map((u) => ({
          sourcePath: u.path,
          specifier: u.raw_specifier,
          reason: u.reason,
        })),
      },
    };
  }

  /**
   * One node of the user's repository, with the commit its source must be fetched at.
   * @param {string} userId
   * @param {string} repoId
   * @param {string} nodeId
   * @returns {Promise<{ path: string, nodeType: string, language: string | null,
   *   sizeBytes: number | null, commitSha: string | null } | null>}
   */
  async function findNode(userId, repoId, nodeId) {
    const { rows } = await pool.query(
      `SELECT n.id, n.path, n.node_type AS "nodeType", n.language, n.size_bytes AS "sizeBytes",
         n.content_hash AS "contentHash", r.commit_sha AS "commitSha"
       FROM nodes n ${OWNED} AND n.repository_id = r.id
       WHERE n.id = $3`,
      [repoId, userId, nodeId],
    );
    return rows[0] ?? null;
  }

  /**
   * Files that import `nodeId`, directly or transitively, up to `maxDepth` hops, each with its
   * shortest distance (spec 7.6). Cycle-safe. Nearest first, then by path.
   * @param {string} userId
   * @param {string} repoId
   * @param {string} nodeId
   * @param {number} [maxDepth]
   * @returns {Promise<{ nodeId: string, path: string, contentHash: string | null,
   *   sizeBytes: number | null, distance: number }[]>}
   */
  async function findDependents(userId, repoId, nodeId, maxDepth = DEPENDENTS_MAX_DEPTH) {
    const { rows } = await pool.query(
      `WITH RECURSIVE dependents AS (
         SELECT e.source_node_id AS node_id, 1 AS depth,
                ARRAY[$1::uuid, e.source_node_id] AS visited
         FROM edges e
         WHERE e.repository_id = $2 AND e.target_node_id = $1
         UNION ALL
         SELECT e.source_node_id, d.depth + 1, d.visited || e.source_node_id
         FROM edges e
         JOIN dependents d ON e.target_node_id = d.node_id
         WHERE e.repository_id = $2
           AND NOT e.source_node_id = ANY (d.visited)
           AND d.depth < $3
       ), shortest AS (
         SELECT node_id, MIN(depth) AS depth FROM dependents GROUP BY node_id
       )
       SELECT n.id AS "nodeId", n.path, n.content_hash AS "contentHash",
              n.size_bytes AS "sizeBytes", s.depth AS distance
       FROM shortest s
       JOIN nodes n ON n.id = s.node_id AND n.repository_id = $2
       JOIN repositories r ON r.id = $2 AND r.user_id = $4
       ORDER BY s.depth, n.path`,
      [nodeId, repoId, maxDepth, userId],
    );
    return rows.map((r) => ({ ...r, distance: Number(r.distance) }));
  }

  /**
   * Every file path of the user's repository.
   * @param {string} userId
   * @param {string} repoId
   * @returns {Promise<Set<string>>}
   */
  async function listFilePaths(userId, repoId) {
    const { rows } = await pool.query(
      `SELECT n.path FROM nodes n ${OWNED} AND n.repository_id = r.id
       WHERE n.node_type = 'file'`,
      [repoId, userId],
    );
    return new Set(rows.map((r) => r.path));
  }

  /**
   * Import edges whose both ends are in `nodeIds`, as importer → imported paths.
   * @param {string} userId
   * @param {string} repoId
   * @param {string[]} nodeIds
   * @returns {Promise<{ source: string, target: string }[]>}
   */
  async function edgesAmong(userId, repoId, nodeIds) {
    const { rows } = await pool.query(
      `SELECT s.path AS source, t.path AS target
       FROM edges e ${OWNED} AND e.repository_id = r.id
       JOIN nodes s ON s.id = e.source_node_id
       JOIN nodes t ON t.id = e.target_node_id
       WHERE e.source_node_id = ANY ($3::uuid[]) AND e.target_node_id = ANY ($3::uuid[])
       ORDER BY s.path, t.path`,
      [repoId, userId, nodeIds],
    );
    return rows;
  }

  return { readGraph, findNode, findDependents, listFilePaths, edgesAmong };
}
