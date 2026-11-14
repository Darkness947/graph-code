import { INGESTION_ERROR_MESSAGES } from '../../errors/codes.js';
import { AppError } from '../../errors/AppError.js';

/** Job columns for a query that aliases `ingestion_jobs` as `j`, in the shape `mapJob` reads. */
export const JOB_COLUMNS = `j.id AS job_id, j.status AS job_status, j.phase AS job_phase,
  j.files_total, j.files_processed, j.files_skipped, j.error_code, j.error_message, j.report`;

/**
 * Maps a row selected with JOB_COLUMNS to the Job object (spec 6.2).
 * @param {Record<string, any>} row
 * @returns {object | null} null when the row has no job
 */
export function mapJob(row) {
  if (!row.job_id) return null;
  return {
    id: row.job_id,
    status: row.job_status,
    phase: row.job_phase,
    filesTotal: row.files_total,
    filesProcessed: row.files_processed,
    filesSkipped: row.files_skipped,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    report: row.report,
  };
}

/**
 * Ingestion job state (spec 5.2, 7.5). The job row is the source of truth: every transition is
 * guarded by the current status, so a job that was recovered, finished or deleted is never
 * revived. Each transition that also moves the repository is one statement (a data-modifying
 * CTE), so the pair is atomic without a transaction.
 * @param {import('pg').Pool} pool
 */
export function createJobRepository(pool) {
  /**
   * Claims a queued job: job `running` with `started_at`, repository `analyzing`.
   * @param {string} jobId
   * @returns {Promise<{ id: string, repositoryId: string, jobType: string } | null>} null when
   *   the job is missing or no longer queued
   */
  async function start(jobId) {
    const { rows } = await pool.query(
      `WITH j AS (
         UPDATE ingestion_jobs SET status = 'running', started_at = now()
         WHERE id = $1 AND status = 'queued'
         RETURNING id, repository_id, job_type
       ), r AS (
         UPDATE repositories SET status = 'analyzing' FROM j WHERE repositories.id = j.repository_id
       )
       SELECT id, repository_id, job_type FROM j`,
      [jobId],
    );
    if (rows.length === 0) return null;
    return { id: rows[0].id, repositoryId: rows[0].repository_id, jobType: rows[0].job_type };
  }

  /**
   * @param {string} jobId
   * @param {string} phase a phase from spec 5.2
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
   * The persisting step (T2.5) must also write `commit_sha`, `file_count`, `edge_count`,
   * `language_summary`, `ingestion_ms` and `last_ingested_at` in that same transaction.
   * @param {string} jobId
   * @param {object} report
   * @param {import('pg').Pool | import('pg').PoolClient} [client]
   * @returns {Promise<boolean>} false when the job is no longer running (the caller rolls back)
   */
  async function succeed(jobId, report, client = pool) {
    const res = await client.query(
      `WITH j AS (
         UPDATE ingestion_jobs SET status = 'succeeded', finished_at = now(), report = $2
         WHERE id = $1 AND status = 'running'
         RETURNING repository_id
       )
       UPDATE repositories SET status = 'ready' FROM j WHERE repositories.id = j.repository_id`,
      [jobId, report],
    );
    return res.rowCount > 0;
  }

  /**
   * Fails an active job with its code and the spec 8.9 message; the repository becomes `failed`.
   * @param {string} jobId
   * @param {keyof typeof INGESTION_ERROR_MESSAGES} code an ingestion code (spec 6.1)
   * @returns {Promise<boolean>} false when the job was not queued or running
   */
  async function fail(jobId, code) {
    if (!Object.hasOwn(INGESTION_ERROR_MESSAGES, code)) {
      throw new Error(`Unknown ingestion code: ${code}`);
    }
    const res = await pool.query(
      `WITH j AS (
         UPDATE ingestion_jobs SET status = 'failed', error_code = $2, error_message = $3,
           finished_at = now()
         WHERE id = $1 AND status IN ('queued', 'running')
         RETURNING repository_id
       )
       UPDATE repositories SET status = 'failed' FROM j WHERE repositories.id = j.repository_id`,
      [jobId, code, INGESTION_ERROR_MESSAGES[code]],
    );
    return res.rowCount > 0;
  }

  /**
   * Startup recovery (spec 7.5 Queue): every queued or running job fails with INTERRUPTED and
   * its repository becomes `failed`, in one statement.
   * @returns {Promise<number>} the number of jobs recovered
   */
  async function recoverStale() {
    const { rows } = await pool.query(
      `WITH j AS (
         UPDATE ingestion_jobs SET status = 'failed', error_code = 'INTERRUPTED', error_message = $1,
           finished_at = now()
         WHERE status IN ('queued', 'running')
         RETURNING repository_id
       ), r AS (
         UPDATE repositories SET status = 'failed' FROM j WHERE repositories.id = j.repository_id
       )
       SELECT count(*)::int AS n FROM j`,
      [INGESTION_ERROR_MESSAGES.INTERRUPTED],
    );
    return rows[0].n;
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
