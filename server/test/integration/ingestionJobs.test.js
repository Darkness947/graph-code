import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { hasTestDb, resetTestDatabase } from '../helpers/db.js';
import { createJobRepository } from '../../src/services/ingestion/jobRepository.js';
import { IngestionOrchestrator, PHASES } from '../../src/services/ingestion/orchestrator.js';
import { IngestionError } from '../../src/services/ingestion/IngestionError.js';
import { createQueue } from '../../src/services/ingestion/queue.js';
import { startIngestion } from '../../src/services/ingestion/startIngestion.js';
import { INGESTION_ERROR_MESSAGES } from '../../src/errors/codes.js';

describe.skipIf(!hasTestDb)(
  'ingestion jobs: orchestrator, recovery, one active job (integration)',
  () => {
    let pool;
    let jobs;
    let userId;
    const logger = { error: vi.fn() };

    async function insertRepo(name, status = 'analyzing') {
      const { rows } = await pool.query(
        `INSERT INTO repositories (user_id, owner, name, display_name, default_branch, visibility, status)
       VALUES ($1, 'o', $2, $3, 'main', 'public', $4) RETURNING id`,
        [userId, name, `o/${name}`, status],
      );
      return rows[0].id;
    }

    async function insertJob(repoId, status = 'queued') {
      const { rows } = await pool.query(
        `INSERT INTO ingestion_jobs (repository_id, job_type, status) VALUES ($1, 'initial', $2) RETURNING id`,
        [repoId, status],
      );
      return rows[0].id;
    }

    const jobRow = async (id) =>
      (await pool.query('SELECT * FROM ingestion_jobs WHERE id = $1', [id])).rows[0];
    const repoStatus = async (id) =>
      (await pool.query('SELECT status FROM repositories WHERE id = $1', [id])).rows[0].status;

    /** Steps that record the job's state as each phase runs; persisting marks success. */
    function recordingSteps(log, overrides = {}) {
      const steps = {};
      for (const phase of PHASES) {
        steps[phase] = async (ctx) => {
          const row = await jobRow(ctx.job.id);
          log.push({ step: phase, status: row.status, phase: row.phase });
          if (overrides[phase]) return overrides[phase](ctx);
          if (phase === 'persisting') {
            await ctx.jobs.succeed(ctx.job.id, { skippedFiles: [], unresolvedCount: 0 });
          }
        };
      }
      return steps;
    }

    beforeAll(async () => {
      pool = await resetTestDatabase();
      jobs = createJobRepository(pool);
      const { rows } = await pool.query(
        `INSERT INTO users (github_id, github_login) VALUES (1, 'u') RETURNING id`,
      );
      userId = rows[0].id;
    });
    afterAll(async () => {
      await pool?.end();
    });
    beforeEach(async () => {
      logger.error.mockReset();
      await pool.query('DELETE FROM repositories');
    });

    describe('IngestionOrchestrator.run (AC1)', () => {
      it('moves a job queued → running through every phase in order → succeeded; repo ready', async () => {
        const repoId = await insertRepo('ok', 'pending');
        const jobId = await insertJob(repoId);
        const log = [];
        await new IngestionOrchestrator({ jobs, steps: recordingSteps(log), logger }).run(jobId);

        expect(log).toEqual(PHASES.map((p) => ({ step: p, status: 'running', phase: p })));
        const row = await jobRow(jobId);
        expect(row).toMatchObject({
          status: 'succeeded',
          phase: 'persisting',
          error_code: null,
          report: { skippedFiles: [], unresolvedCount: 0 },
        });
        expect(row.started_at).toBeInstanceOf(Date);
        expect(row.finished_at.getTime()).toBeGreaterThanOrEqual(row.started_at.getTime());
        expect(await repoStatus(repoId)).toBe('ready');
        expect(logger.error).not.toHaveBeenCalled();
      });

      it('sets the repository to analyzing when the job starts', async () => {
        const repoId = await insertRepo('start', 'failed');
        const jobId = await insertJob(repoId);
        let seen;
        const steps = recordingSteps([], {
          fetching: async () => {
            seen = await repoStatus(repoId);
            throw new IngestionError('DOWNLOAD_FAILED');
          },
        });
        await new IngestionOrchestrator({ jobs, steps, logger }).run(jobId);
        expect(seen).toBe('analyzing');
      });

      it.each([
        ['fetching', new Error('network'), 'DOWNLOAD_FAILED'],
        ['extracting', new IngestionError('ARCHIVE_LIMIT_EXCEEDED'), 'ARCHIVE_LIMIT_EXCEEDED'],
        ['extracting', new IngestionError('REPO_TOO_LARGE'), 'REPO_TOO_LARGE'],
        ['parsing', new TypeError('bug'), 'INTERNAL'],
        ['resolving', new Error('bug'), 'INTERNAL'],
        ['persisting', new Error('insert failed'), 'PERSIST_FAILED'],
      ])('a failure in %s fails the job with its code (%#)', async (phase, error, code) => {
        const repoId = await insertRepo(`f-${phase}-${code}`.toLowerCase());
        const jobId = await insertJob(repoId);
        const log = [];
        const steps = recordingSteps(log, {
          [phase]: async () => {
            throw error;
          },
        });
        await new IngestionOrchestrator({ jobs, steps, logger }).run(jobId);

        expect(log.map((l) => l.step)).toEqual(PHASES.slice(0, PHASES.indexOf(phase) + 1));
        const row = await jobRow(jobId);
        expect(row).toMatchObject({
          status: 'failed',
          phase,
          error_code: code,
          error_message: INGESTION_ERROR_MESSAGES[code],
        });
        expect(row.finished_at).toBeInstanceOf(Date);
        expect(await repoStatus(repoId)).toBe('failed');
        expect(logger.error).toHaveBeenCalledOnce();
      });

      it('placeholder steps (before T2.3) fail the job with INTERNAL instead of leaving it queued', async () => {
        const repoId = await insertRepo('placeholder');
        const jobId = await insertJob(repoId);
        await new IngestionOrchestrator({ jobs, logger }).run(jobId);
        expect(await jobRow(jobId)).toMatchObject({ status: 'failed', error_code: 'INTERNAL' });
        expect(await repoStatus(repoId)).toBe('failed');
      });

      it.each(['running', 'succeeded', 'failed'])(
        'does nothing for a job that is %s',
        async (status) => {
          const repoId = await insertRepo(`skip-${status}`, 'ready');
          const jobId = await insertJob(repoId, status);
          const log = [];
          await new IngestionOrchestrator({ jobs, steps: recordingSteps(log), logger }).run(jobId);
          expect(log).toEqual([]);
          expect((await jobRow(jobId)).status).toBe(status);
          expect(await repoStatus(repoId)).toBe('ready');
        },
      );

      it('does nothing for an unknown job id', async () => {
        const log = [];
        await new IngestionOrchestrator({ jobs, steps: recordingSteps(log), logger }).run(
          '00000000-0000-4000-8000-000000000000',
        );
        expect(log).toEqual([]);
      });

      it('stops without reviving a job that was failed while it ran', async () => {
        const repoId = await insertRepo('interrupted');
        const jobId = await insertJob(repoId);
        const log = [];
        const steps = recordingSteps(log, {
          extracting: async () => {
            await jobs.recoverStale();
          },
        });
        await new IngestionOrchestrator({ jobs, steps, logger }).run(jobId);

        expect(log.map((l) => l.step)).toEqual(['fetching', 'extracting']);
        expect(await jobRow(jobId)).toMatchObject({ status: 'failed', error_code: 'INTERRUPTED' });
        expect(await jobs.succeed(jobId, {})).toBe(false);
        expect(await jobs.updateCounts(jobId, { filesProcessed: 5 })).toBe(false);
        expect(await jobs.fail(jobId, 'INTERNAL')).toBe(false);
        expect(await jobRow(jobId)).toMatchObject({
          error_code: 'INTERRUPTED',
          files_processed: 0,
        });
      });

      it('updates progress counters while running, keeping omitted ones', async () => {
        const repoId = await insertRepo('counts');
        const jobId = await insertJob(repoId);
        await jobs.start(jobId);
        await jobs.updateCounts(jobId, { filesTotal: 63, filesProcessed: 0 });
        await jobs.updateCounts(jobId, { filesProcessed: 20, filesSkipped: 1 });
        expect(await jobRow(jobId)).toMatchObject({
          files_total: 63,
          files_processed: 20,
          files_skipped: 1,
        });
      });

      it('two concurrent starts of one job: exactly one claims it', async () => {
        const repoId = await insertRepo('race');
        const jobId = await insertJob(repoId);
        const results = await Promise.all([jobs.start(jobId), jobs.start(jobId)]);
        expect(results.filter(Boolean)).toHaveLength(1);
        expect(results.find(Boolean)).toEqual({
          id: jobId,
          repositoryId: repoId,
          jobType: 'initial',
        });
      });

      it('runs through the queue end to end', async () => {
        const repoId = await insertRepo('queued-run');
        const jobId = await insertJob(repoId);
        const orchestrator = new IngestionOrchestrator({ jobs, steps: recordingSteps([]), logger });
        const queue = createQueue({ concurrency: 1, run: (id) => orchestrator.run(id), logger });
        queue.enqueue(jobId);
        await queue.idle();
        expect((await jobRow(jobId)).status).toBe('succeeded');
      });
    });

    describe('stale-job recovery on startup (AC2)', () => {
      it('startIngestion recovers stale jobs first, then runs newly enqueued ones', async () => {
        const staleRepo = await insertRepo('stale');
        const staleJob = await insertJob(staleRepo, 'running');
        const startupLogger = { log: vi.fn(), error: vi.fn() };
        const queue = await startIngestion({
          pool,
          concurrency: 1,
          steps: recordingSteps([]),
          logger: startupLogger,
        });

        expect(queue.recovered).toBe(1);
        expect(await jobRow(staleJob)).toMatchObject({
          status: 'failed',
          error_code: 'INTERRUPTED',
        });
        expect(await repoStatus(staleRepo)).toBe('failed');
        expect(startupLogger.log).toHaveBeenCalledWith(
          'Marked 1 interrupted ingestion job(s) as failed',
        );

        // The retry the user makes after the restart runs to completion.
        const retryJob = await insertJob(staleRepo, 'queued');
        queue.enqueue(retryJob);
        await queue.idle();
        expect((await jobRow(retryJob)).status).toBe('succeeded');
        expect(await repoStatus(staleRepo)).toBe('ready');
      });

      it('fails every queued or running job with INTERRUPTED and its repository; leaves others', async () => {
        const queuedRepo = await insertRepo('q');
        const queuedJob = await insertJob(queuedRepo, 'queued');
        const runningRepo = await insertRepo('r');
        const runningJob = await insertJob(runningRepo, 'running');
        const readyRepo = await insertRepo('ready', 'ready');
        const doneJob = await insertJob(readyRepo, 'succeeded');
        const failedRepo = await insertRepo('failed', 'failed');
        const failedJob = await insertJob(failedRepo, 'failed');

        expect(await jobs.recoverStale()).toBe(2);

        for (const id of [queuedJob, runningJob]) {
          const row = await jobRow(id);
          expect(row).toMatchObject({
            status: 'failed',
            error_code: 'INTERRUPTED',
            error_message: 'Analysis was interrupted by a server restart. Try again.',
          });
          expect(row.finished_at).toBeInstanceOf(Date);
        }
        expect(await repoStatus(queuedRepo)).toBe('failed');
        expect(await repoStatus(runningRepo)).toBe('failed');
        expect(await jobRow(doneJob)).toMatchObject({ status: 'succeeded', error_code: null });
        expect(await jobRow(failedJob)).toMatchObject({ status: 'failed', error_code: null });
        expect(await repoStatus(readyRepo)).toBe('ready');
      });

      it('is a no-op with nothing to recover', async () => {
        await insertJob(await insertRepo('done', 'ready'), 'succeeded');
        expect(await jobs.recoverStale()).toBe(0);
      });
    });

    describe('one active job per repository (AC3)', () => {
      it.each([
        ['queued', 'queued'],
        ['queued', 'running'],
        ['running', 'queued'],
        ['running', 'running'],
      ])('a %s job blocks a second %s job (one_active_job_per_repo)', async (first, second) => {
        const repoId = await insertRepo(`dup-${first}-${second}`);
        await insertJob(repoId, first);
        await expect(insertJob(repoId, second)).rejects.toMatchObject({
          code: '23505',
          constraint: 'one_active_job_per_repo',
        });
      });

      it('allows a new queued job once earlier jobs succeeded or failed', async () => {
        const repoId = await insertRepo('history');
        await insertJob(repoId, 'succeeded');
        await insertJob(repoId, 'failed');
        await insertJob(repoId, 'failed');
        await expect(insertJob(repoId, 'queued')).resolves.toBeTruthy();
      });

      it('allows a retry after recovery fails the interrupted job', async () => {
        const repoId = await insertRepo('retry');
        await insertJob(repoId, 'running');
        await jobs.recoverStale();
        await expect(insertJob(repoId, 'queued')).resolves.toBeTruthy();
      });

      it('active jobs on different repositories do not conflict', async () => {
        await insertJob(await insertRepo('a1'), 'running');
        await expect(insertJob(await insertRepo('a2'), 'running')).resolves.toBeTruthy();
      });
    });
  },
);
