/** Most unresolved imports returned with a graph (spec 7.6). */
export const UNRESOLVED_LIMIT = 200;

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
    const client = await pool.connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const params = [repoId, userId];
      const nodes = await client.query(
        `SELECT n.id, n.path, n.name, n.node_type, n.language, n.size_bytes, n.metrics
         FROM nodes n ${OWNED} AND n.repository_id = r.id
         ORDER BY n.path`,
        params,
      );
      const edges = await client.query(
        `SELECT e.id, e.source_node_id, e.target_node_id
         FROM edges e ${OWNED} AND e.repository_id = r.id
         ORDER BY e.id`,
        params,
      );
      // The window count is computed before LIMIT, so it is the full total.
      const unresolved = await client.query(
        `SELECT n.path, u.raw_specifier, u.reason, COUNT(*) OVER () AS total
         FROM unresolved_imports u
         JOIN nodes n ON n.id = u.source_node_id
         ${OWNED} AND n.repository_id = r.id
         ORDER BY n.path, u.id
         LIMIT $3`,
        [...params, UNRESOLVED_LIMIT],
      );
      await client.query('COMMIT');
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
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * One node of the user's repository, with what is needed to fetch its source.
   * @param {string} userId
   * @param {string} repoId
   * @param {string} nodeId
   * @returns {Promise<{ path: string, nodeType: string, language: string | null,
   *   sizeBytes: number | null, owner: string, name: string, commitSha: string | null } | null>}
   */
  async function findNode(userId, repoId, nodeId) {
    const { rows } = await pool.query(
      `SELECT n.path, n.node_type, n.language, n.size_bytes, r.owner, r.name, r.commit_sha
       FROM nodes n ${OWNED} AND n.repository_id = r.id
       WHERE n.id = $3`,
      [repoId, userId, nodeId],
    );
    const row = rows[0];
    if (!row) return null;
    return {
      path: row.path,
      nodeType: row.node_type,
      language: row.language,
      sizeBytes: row.size_bytes,
      owner: row.owner,
      name: row.name,
      commitSha: row.commit_sha,
    };
  }

  return { readGraph, findNode };
}
