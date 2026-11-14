import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { hasTestDb, resetTestDatabase } from '../helpers/db.js';
import { buildZip } from '../helpers/zip.js';
import { createPipelineSteps } from '../../src/services/ingestion/orchestrator.js';
import { startIngestion } from '../../src/services/ingestion/startIngestion.js';
import { limitsFromConfig } from '../../src/services/ingestion/limits.js';
import { INGESTION_ERROR_MESSAGES } from '../../src/errors/codes.js';
import { AppError } from '../../src/errors/AppError.js';

const SHA = '0123456789abcdef0123456789abcdef01234567';
const LIMITS = limitsFromConfig({
  MAX_ZIP_BYTES: 52428800,
  MAX_ZIP_ENTRIES: 20000,
  MAX_FILE_BYTES: 1048576,
  MAX_TOTAL_SOURCE_BYTES: 52428800,
  MAX_COMPRESSION_RATIO: 100,
  MAX_SOURCE_FILES: 1000,
});

describe.skipIf(!hasTestDb)('fetching and extracting through the queue (integration)', () => {
  let pool;
  let userId;
  const logger = { log: vi.fn(), error: vi.fn() };
  const crypto = { decrypt: vi.fn(() => 'gho_token') };

  async function insertQueuedJob(name) {
    const repo = await pool.query(
      `INSERT INTO repositories (user_id, owner, name, display_name, default_branch, visibility)
       VALUES ($1, 'octo', $2, $3, 'trunk', 'public') RETURNING id`,
      [userId, name, `Octo/${name}`],
    );
    const job = await pool.query(
      `INSERT INTO ingestion_jobs (repository_id, job_type) VALUES ($1, 'initial') RETURNING id`,
      [repo.rows[0].id],
    );
    return { repoId: repo.rows[0].id, jobId: job.rows[0].id };
  }

  /** Runs one job with the real fetching and extracting steps and a mocked GitHub. */
  async function run(name, github, parsing = async () => {}) {
    const steps = {
      ...createPipelineSteps({ pool, crypto, github, limits: LIMITS }),
      parsing: async (ctx) => {
        // Stop here: later phases belong to T2.4 and T2.5.
        await parsing(ctx);
        throw new Error('stop after extracting');
      },
    };
    const queue = await startIngestion({ pool, concurrency: 1, steps, logger });
    // After startup: recovery would fail a job that was already queued.
    const ids = await insertQueuedJob(name);
    queue.enqueue(ids.jobId);
    await queue.idle();
    const job = (await pool.query('SELECT * FROM ingestion_jobs WHERE id = $1', [ids.jobId]))
      .rows[0];
    const repo = (await pool.query('SELECT * FROM repositories WHERE id = $1', [ids.repoId]))
      .rows[0];
    return { job, repo };
  }

  const githubWith = (archive) => ({
    getHeadCommit: vi.fn().mockResolvedValue(SHA),
    downloadArchive: vi.fn().mockResolvedValue(archive),
  });

  beforeAll(async () => {
    pool = await resetTestDatabase();
    const { rows } = await pool.query(
      `INSERT INTO users (github_id, github_login, access_token_enc, token_key_id)
       VALUES (1, 'u', $1, 1) RETURNING id`,
      [Buffer.from('encrypted')],
    );
    userId = rows[0].id;
  });
  afterAll(async () => {
    await pool?.end();
  });
  beforeEach(async () => {
    await pool.query('DELETE FROM repositories');
  });

  it('a job reaches parsing with the pinned SHA, the files and files_total set', async () => {
    const github = githubWith(
      await buildZip(
        {
          'tsconfig.json': '{}',
          'src/app.ts': "import './util';",
          'src/util.ts': 'export {};',
          'src/util.test.ts': 'x',
          'src/big.js': 'x'.repeat(LIMITS.maxFileBytes + 1),
          'node_modules/p/index.js': 'x',
        },
        { compress: false },
      ),
    );
    let seen;
    const { job } = await run('ok', github, async (ctx) => {
      seen = { ...ctx };
    });

    expect(github.getHeadCommit).toHaveBeenCalledExactlyOnceWith(
      'gho_token',
      'octo',
      'ok',
      'trunk',
    );
    expect(github.downloadArchive).toHaveBeenCalledExactlyOnceWith('octo', 'ok', SHA);
    expect(seen.commitSha).toBe(SHA);
    expect(seen.archive).toBeUndefined();
    expect(seen.files.map((f) => f.path)).toEqual(['src/app.ts', 'src/util.ts']);
    expect(seen.configFiles.map((f) => f.path)).toEqual(['tsconfig.json']);
    expect(seen.skipped).toEqual([{ path: 'src/big.js', reason: 'too_large' }]);
    expect(job).toMatchObject({ phase: 'parsing', files_total: 2, files_skipped: 1 });
  });

  it.each([
    ['ARCHIVE_LIMIT_EXCEEDED', async () => buildZip({ 'bomb.js': Buffer.alloc(500_000, 0x20) })],
    ['ARCHIVE_INVALID', async () => Buffer.from('not a zip')],
    ['NO_SUPPORTED_FILES', async () => buildZip({ 'README.md': '# hi' })],
    [
      'REPO_TOO_LARGE',
      async () =>
        buildZip(Object.fromEntries(Array.from({ length: 1001 }, (_, i) => [`f${i}.js`, 'x']))),
    ],
  ])('%s fails the job in extracting with the spec 8.9 message', async (code, makeZip) => {
    const { job, repo } = await run(code.toLowerCase(), githubWith(await makeZip()));
    expect(job).toMatchObject({
      status: 'failed',
      phase: 'extracting',
      error_code: code,
      error_message: INGESTION_ERROR_MESSAGES[code],
      files_total: null,
    });
    expect(job.finished_at).toBeInstanceOf(Date);
    expect(repo.status).toBe('failed');
    expect(repo.commit_sha).toBeNull();
  });

  it('a GitHub failure fails the job in fetching with DOWNLOAD_FAILED', async () => {
    const github = {
      getHeadCommit: vi.fn().mockRejectedValue(new AppError('GITHUB_UNAVAILABLE', 'down')),
      downloadArchive: vi.fn(),
    };
    const { job, repo } = await run('down', github);
    expect(job).toMatchObject({
      status: 'failed',
      phase: 'fetching',
      error_code: 'DOWNLOAD_FAILED',
      error_message: INGESTION_ERROR_MESSAGES.DOWNLOAD_FAILED,
    });
    expect(repo.status).toBe('failed');
    expect(github.downloadArchive).not.toHaveBeenCalled();
  });
});
