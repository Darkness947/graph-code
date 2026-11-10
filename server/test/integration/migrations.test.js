import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { config } from 'dotenv';
import { runMigrations } from '../../src/db/migrate.js';

config({ quiet: true });
const { hasTestDb, resetTestDatabase } = await import('../helpers/db.js');

if (!hasTestDb) {
  console.warn('WARNING: TEST_DATABASE_URL is not set; migration integration tests are SKIPPED.');
}

const TABLES = [
  'users',
  'session',
  'repositories',
  'ingestion_jobs',
  'nodes',
  'edges',
  'unresolved_imports',
  'ai_results',
  'ai_audit_log',
  'schema_migrations',
];

describe.skipIf(!hasTestDb)('001_init migration (test database)', () => {
  let pool;

  beforeAll(async () => {
    pool = await resetTestDatabase();
  });

  afterAll(async () => {
    await pool?.end();
  });

  it('creates every table from Part 5.2', async () => {
    const { rows } = await pool.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'",
    );
    const names = rows.map((r) => r.table_name);
    for (const t of TABLES) expect(names).toContain(t);
  });

  it('installs the ltree extension', async () => {
    const { rows } = await pool.query("SELECT 1 FROM pg_extension WHERE extname = 'ltree'");
    expect(rows).toHaveLength(1);
  });

  it('records the applied file, and re-running applies nothing', async () => {
    const first = await pool.query('SELECT filename FROM schema_migrations');
    expect(first.rows.map((r) => r.filename)).toEqual(['001_init.sql']);
    expect(await runMigrations(pool)).toEqual([]);
    const second = await pool.query('SELECT count(*)::int AS n FROM schema_migrations');
    expect(second.rows[0].n).toBe(1);
  });

  describe('constraints', () => {
    let userId;
    let repoId;
    let nodeA;
    let nodeB;

    beforeAll(async () => {
      userId = (
        await pool.query(
          "INSERT INTO users (github_id, github_login) VALUES (1, 'tester') RETURNING id",
        )
      ).rows[0].id;
      repoId = (
        await pool.query(
          `INSERT INTO repositories (user_id, owner, name, display_name, default_branch, visibility)
           VALUES ($1, 'o', 'n', 'O/N', 'main', 'public') RETURNING id`,
          [userId],
        )
      ).rows[0].id;
      const insertNode = async (path, ltree) =>
        (
          await pool.query(
            `INSERT INTO nodes (repository_id, path, path_ltree, name, node_type)
             VALUES ($1, $2, $3::ltree, $2, 'file') RETURNING id`,
            [repoId, path, ltree],
          )
        ).rows[0].id;
      nodeA = await insertNode('a.js', 'r.a_js');
      nodeB = await insertNode('b.js', 'r.b_js');
    });

    it('rejects a self-referencing edge', async () => {
      await expect(
        pool.query(
          'INSERT INTO edges (repository_id, source_node_id, target_node_id) VALUES ($1, $2, $2)',
          [repoId, nodeA],
        ),
      ).rejects.toThrow();
    });

    it('rejects a duplicate edge', async () => {
      const sql =
        'INSERT INTO edges (repository_id, source_node_id, target_node_id) VALUES ($1, $2, $3)';
      await pool.query(sql, [repoId, nodeA, nodeB]);
      await expect(pool.query(sql, [repoId, nodeA, nodeB])).rejects.toThrow();
    });

    it('allows only one queued or running job per repository', async () => {
      const sql = "INSERT INTO ingestion_jobs (repository_id, job_type) VALUES ($1, 'initial')";
      await pool.query(sql, [repoId]);
      await expect(pool.query(sql, [repoId])).rejects.toThrow();
    });

    it('cascades deletes from the repository to its nodes and edges', async () => {
      await pool.query('DELETE FROM repositories WHERE id = $1', [repoId]);
      const nodes = await pool.query('SELECT count(*)::int AS n FROM nodes');
      const edges = await pool.query('SELECT count(*)::int AS n FROM edges');
      expect(nodes.rows[0].n).toBe(0);
      expect(edges.rows[0].n).toBe(0);
    });
  });
});
