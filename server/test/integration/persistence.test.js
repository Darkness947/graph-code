import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { hasTestDb, resetTestDatabase } from '../helpers/db.js';
import { failingParser, zipFixtureRepo } from '../helpers/fixtures.js';
import { DEFAULT_LIMITS as LIMITS } from '../helpers/limits.js';
import {
  createPipelineSteps,
  startIngestion,
} from '../../src/services/ingestion/startIngestion.js';
import { createParserService } from '../../src/services/ingestion/parsing/parserService.js';
import { INGESTION_ERROR_MESSAGES } from '../../src/errors/codes.js';

const SHA = '0123456789abcdef0123456789abcdef01234567';
const parserService = failingParser(createParserService({ backend: 'native' }));

describe.skipIf(!hasTestDb)('atomic persistence (integration)', { timeout: 60000 }, () => {
  let pool;
  let userId;
  let archive;

  beforeAll(async () => {
    pool = await resetTestDatabase();
    userId = (
      await pool.query(
        `INSERT INTO users (github_id, github_login, access_token_enc, token_key_id)
         VALUES (1, 'u', $1, 1) RETURNING id`,
        [Buffer.from('encrypted')],
      )
    ).rows[0].id;
    archive = await zipFixtureRepo('ingest-sample');
  });
  afterAll(async () => {
    await pool?.end();
  });

  const newRepo = async (name) =>
    (
      await pool.query(
        `INSERT INTO repositories (user_id, owner, name, display_name, default_branch, visibility)
         VALUES ($1, 'octo', $2, $2, 'main', 'public') RETURNING id`,
        [userId, name],
      )
    ).rows[0].id;

  /** Runs one job on the repository through the real pipeline; returns the final job row. */
  async function ingest(repoId, persistHook) {
    const github = {
      getHeadCommit: vi.fn().mockResolvedValue(SHA),
      downloadArchive: vi.fn().mockResolvedValue(archive),
    };
    const steps = createPipelineSteps({
      pool,
      crypto: { decrypt: vi.fn(() => 'gho_token') },
      github,
      limits: LIMITS,
      parserService,
      persistHook,
    });
    const queue = await startIngestion({
      pool,
      concurrency: 1,
      steps,
      logger: { log: vi.fn(), error: vi.fn() },
    });
    const { rows } = await pool.query(
      `INSERT INTO ingestion_jobs (repository_id, job_type) VALUES ($1, 'initial') RETURNING id`,
      [repoId],
    );
    queue.enqueue(rows[0].id);
    await queue.idle();
    return (await pool.query('SELECT * FROM ingestion_jobs WHERE id = $1', [rows[0].id])).rows[0];
  }

  const counts = async (repoId) =>
    (
      await pool.query(
        `SELECT (SELECT count(*)::int FROM nodes WHERE repository_id = $1) AS nodes,
                (SELECT count(*)::int FROM edges WHERE repository_id = $1) AS edges,
                (SELECT count(*)::int FROM unresolved_imports u
                   JOIN nodes n ON n.id = u.source_node_id WHERE n.repository_id = $1) AS unresolved`,
        [repoId],
      )
    ).rows[0];
  const repoRow = async (id) =>
    (await pool.query('SELECT * FROM repositories WHERE id = $1', [id])).rows[0];
  const nodeIds = async (repoId) =>
    (await pool.query('SELECT id FROM nodes WHERE repository_id = $1 ORDER BY id', [repoId])).rows;

  it('AC2: a successful run writes the graph and every repository statistic', async () => {
    const repoId = await newRepo('ok');
    const job = await ingest(repoId);
    expect(job).toMatchObject({ status: 'succeeded', phase: 'persisting', error_code: null });
    expect(job.finished_at).not.toBeNull();
    expect(job.report).toEqual({
      skippedFiles: [{ path: 'src/broken.js', reason: 'parse_error' }],
      unresolvedCount: 4,
    });
    const repo = await repoRow(repoId);
    expect(repo).toMatchObject({
      status: 'ready',
      commit_sha: SHA,
      file_count: 8,
      edge_count: 10,
      language_summary: { js: 2, tsx: 2, jsx: 1, ts: 3 },
    });
    expect(repo.ingestion_ms).toBeGreaterThanOrEqual(0);
    expect(repo.last_ingested_at).not.toBeNull();
    expect(await counts(repoId)).toEqual({ nodes: 11, edges: 10, unresolved: 4 });
    const edges = await pool.query(
      `SELECT s.path AS source, t.path AS target FROM edges e
       JOIN nodes s ON s.id = e.source_node_id JOIN nodes t ON t.id = e.target_node_id
       WHERE e.repository_id = $1 AND s.path = 'index.js' ORDER BY t.path`,
      [repoId],
    );
    expect(edges.rows).toEqual([
      { source: 'index.js', target: 'src/app.tsx' },
      { source: 'index.js', target: 'src/lazy.js' },
    ]);
  });

  it('AC2: a second run replaces the graph instead of duplicating it', async () => {
    const repoId = await newRepo('twice');
    await ingest(repoId);
    await ingest(repoId);
    expect(await counts(repoId)).toEqual({ nodes: 11, edges: 10, unresolved: 4 });
  });

  it('AC1: a failure mid-insert on a first run leaves no rows and fails the job', async () => {
    const repoId = await newRepo('fail-first');
    const job = await ingest(repoId, ({ table }) => {
      if (table === 'edges') throw new Error('forced failure');
    });
    expect(job).toMatchObject({ status: 'failed', error_code: 'PERSIST_FAILED' });
    expect(job.error_message).toBe(INGESTION_ERROR_MESSAGES.PERSIST_FAILED);
    expect(await counts(repoId)).toEqual({ nodes: 0, edges: 0, unresolved: 0 });
    expect(await repoRow(repoId)).toMatchObject({
      status: 'failed',
      file_count: null,
      commit_sha: null,
    });
  });

  it('leaves everything to startup recovery when the job stops running mid-persist', async () => {
    const repoId = await newRepo('stopped');
    let stopped = false;
    const job = await ingest(repoId, async () => {
      if (stopped) return;
      stopped = true;
      // What startup recovery does to a job: fail it as INTERRUPTED, with its repository.
      await pool.query(
        `WITH j AS (
           UPDATE ingestion_jobs SET status = 'failed', error_code = 'INTERRUPTED', finished_at = now()
           WHERE repository_id = $1 AND status = 'running' RETURNING repository_id
         ) UPDATE repositories SET status = 'failed' FROM j WHERE repositories.id = j.repository_id`,
        [repoId],
      );
    });
    // succeed() reported the job was no longer running, so nothing was written or overwritten.
    expect(job).toMatchObject({ status: 'failed', error_code: 'INTERRUPTED' });
    expect(await counts(repoId)).toEqual({ nodes: 0, edges: 0, unresolved: 0 });
    expect(await repoRow(repoId)).toMatchObject({
      status: 'failed',
      file_count: null,
      commit_sha: null,
      last_ingested_at: null,
    });
  });

  it('AC1: a failure on a resync keeps the earlier graph and statistics untouched', async () => {
    const repoId = await newRepo('fail-resync');
    await ingest(repoId);
    const before = await repoRow(repoId);
    const ids = await nodeIds(repoId);

    const job = await ingest(repoId, ({ table }) => {
      if (table === 'unresolved_imports') throw new Error('forced failure');
    });
    expect(job).toMatchObject({ status: 'failed', error_code: 'PERSIST_FAILED' });
    expect(await counts(repoId)).toEqual({ nodes: 11, edges: 10, unresolved: 4 });
    expect(await nodeIds(repoId)).toEqual(ids);
    expect(await repoRow(repoId)).toMatchObject({
      status: 'failed',
      file_count: before.file_count,
      edge_count: before.edge_count,
      commit_sha: before.commit_sha,
      last_ingested_at: before.last_ingested_at,
    });
  });
});
