import { INGESTION_ERROR_MESSAGES } from '../../errors/codes.js';
import { AppError } from '../../errors/AppError.js';
import { JOB_COLUMNS, mapJob } from '../repos/repositoryService.js';

/** Pipeline phases in order (spec 5.2 `ingestion_jobs.phase`, 7.5). */
export const PHASES = Object.freeze([
  'fetching',
  'extracting',
  'parsing',
  'resolving',
  'persisting',
]);

/**
 * Runs `fn` inside one transaction on a dedicated client.
 * @template T
 * @param {import('pg').Pool} pool
 * @param {(client: import('pg').PoolClient) => Promise<T>} fn
 * @returns {Promise<T>}
 */
async function inTransaction(pool, fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Ingestion job state (spec 5.2, 7.5). The job row is the source of truth: every transition is
 * guarded by the current status, so a job that was recovered, finished or deleted is never revived.
 * @param {import('pg').Pool} pool
 */
export function createJobRepository(pool) {
  /**
   * Claims a queued job: job `running` in phase `fetching` with `started_at`, repository `analyzing`.
   * @param {string} jobId
   * @returns {Promise<{ id: string, repositoryId: string, jobType: string } | null>} null when
   *   the job is missing or no longer queued
   */
  function start(jobId) {
    return inTransaction(pool, async (client) => {
      const { rows } = await client.query(
        `UPDATE ingestion_jobs SET status = 'running', phase = 'fetching', started_at = now()
         WHERE id = $1 AND status = 'queued'
         RETURNING id, repository_id, job_type`,
        [jobId],
      );
      if (rows.length === 0) return null;
      const job = rows[0];
      await client.query(`UPDATE repositories SET status = 'analyzing' WHERE id = $1`, [
        job.repository_id,
      ]);
      return { id: job.id, repositoryId: job.repository_id, jobType: job.job_type };
    });
  }

  /**
   * @param {string} jobId
   * @param {string} phase one of PHASES
   * @returns {Promise<boolean>} false when the job is no longer running
   */
  async function setPhase(jobId, phase) {
    const res = await pool.query(
      `UPDATE ingestion_jobs SET phase = $2 WHERE id = $1 AND status = 'running'`,
      [jobId, phase],
    );
    return res.rowCount > 0;
  }

  /**
   * Updates the progress counters; omitted counters keep their value.
   * @param {string} jobId
   * @param {{ filesTotal?: number, filesProcessed?: number, filesSkipped?: number }} counts
   * @returns {Promise<boolean>} false when the job is no longer running
   */
  async function updateCounts(jobId, { filesTotal, filesProcessed, filesSkipped }) {
    const res = await pool.query(
      `UPDATE ingestion_jobs SET files_total = COALESCE($2, files_total),
         files_processed = COALESCE($3, files_processed), files_skipped = COALESCE($4, files_skipped)
       WHERE id = $1 AND status = 'running'`,
      [jobId, filesTotal ?? null, filesProcessed ?? null, filesSkipped ?? null],
    );
    return res.rowCount > 0;
  }

  /**
   * Marks the job `succeeded` with `finished_at` and `report`, and the repository `ready`.
   * Pass the persisting transaction's client so this commits atomically with the graph (7.5 step 5).
   * @param {string} jobId
   * @param {object} report
   * @param {import('pg').Pool | import('pg').PoolClient} [client]
   * @returns {Promise<boolean>} false when the job is no longer running (the caller rolls back)
   */
  async function succeed(jobId, report, client = pool) {
    const { rows } = await client.query(
      `UPDATE ingestion_jobs SET status = 'succeeded', finished_at = now(), report = $2
       WHERE id = $1 AND status = 'running'
       RETURNING repository_id`,
      [jobId, report],
    );
    if (rows.length === 0) return false;
    await client.query(`UPDATE repositories SET status = 'ready' WHERE id = $1`, [
      rows[0].repository_id,
    ]);
    return true;
  }

  /**
   * Fails an active job with its code and the spec 8.9 message; the repository becomes `failed`.
   * @param {string} jobId
   * @param {string} code one of the ingestion codes (spec 6.1)
   * @returns {Promise<boolean>} false when the job was not queued or running
   */
  function fail(jobId, code) {
    return inTransaction(pool, async (client) => {
      const { rows } = await client.query(
        `UPDATE ingestion_jobs SET status = 'failed', error_code = $2, error_message = $3, finished_at = now()
         WHERE id = $1 AND status IN ('queued', 'running')
         RETURNING repository_id`,
        [jobId, code, INGESTION_ERROR_MESSAGES[code]],
      );
      if (rows.length === 0) return false;
      await client.query(`UPDATE repositories SET status = 'failed' WHERE id = $1`, [
        rows[0].repository_id,
      ]);
      return true;
    });
  }

  /**
   * Startup recovery (spec 7.5 Queue): every queued or running job fails with INTERRUPTED and
   * its repository becomes `failed`, in one transaction.
   * @returns {Promise<number>} the number of jobs recovered
   */
  function recoverStale() {
    return inTransaction(pool, async (client) => {
      const { rows } = await client.query(
        `UPDATE ingestion_jobs SET status = 'failed', error_code = 'INTERRUPTED', error_message = $1,
           finished_at = now()
         WHERE status IN ('queued', 'running')
         RETURNING repository_id`,
        [INGESTION_ERROR_MESSAGES.INTERRUPTED],
      );
      if (rows.length > 0) {
        await client.query(`UPDATE repositories SET status = 'failed' WHERE id = ANY($1::uuid[])`, [
          rows.map((r) => r.repository_id),
        ]);
      }
      return rows.length;
    });
  }

  /**
   * One job, only if its repository belongs to the user (spec 6.2 `GET /api/jobs/:jobId`).
   * @param {string} userId
   * @param {string} jobId
   * @returns {Promise<object>} the Job; throws NOT_FOUND (also for another user's job)
   */
  async function getForUser(userId, jobId) {
    const { rows } = await pool.query(
      `SELECT ${JOB_COLUMNS} FROM ingestion_jobs j
       JOIN repositories r ON r.id = j.repository_id AND r.user_id = $2
       WHERE j.id = $1`,
      [jobId, userId],
    );
    if (rows.length === 0) throw new AppError('NOT_FOUND', 'Job not found.');
    return mapJob(rows[0]);
  }

  return { start, setPhase, updateCounts, succeed, fail, recoverStale, getForUser };
}
