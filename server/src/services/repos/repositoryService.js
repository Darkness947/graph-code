import { AppError } from '../../errors/AppError.js';

const JOB_COLUMNS = `j.id AS job_id, j.status AS job_status, j.phase AS job_phase,
  j.files_total, j.files_processed, j.files_skipped, j.error_code, j.error_message, j.report`;

/**
 * Maps a joined row (job columns aliased by JOB_COLUMNS) to the Job object (spec 6.2).
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
 * Maps a repository row (with joined latest-job columns) to the Repository object (spec 6.2).
 * @param {Record<string, any>} row
 * @returns {object}
 */
export function mapRepository(row) {
  return {
    id: row.id,
    owner: row.owner,
    name: row.name,
    displayName: row.display_name,
    status: row.status,
    fileCount: row.file_count,
    edgeCount: row.edge_count,
    languageSummary: row.language_summary,
    lastIngestedAt: row.last_ingested_at ? new Date(row.last_ingested_at).toISOString() : null,
    ingestionMs: row.ingestion_ms,
    latestJob: mapJob(row),
  };
}

const REPO_SELECT = `SELECT r.id, r.owner, r.name, r.display_name, r.status, r.file_count, r.edge_count,
    r.language_summary, r.last_ingested_at, r.ingestion_ms, ${JOB_COLUMNS}
  FROM repositories r
  LEFT JOIN LATERAL (
    SELECT * FROM ingestion_jobs WHERE repository_id = r.id ORDER BY created_at DESC, id DESC LIMIT 1
  ) j ON true`;

/**
 * Key used to match repositories by owner and name, regardless of capitalization.
 * @param {string} owner
 * @param {string} name
 */
export function repoKey(owner, name) {
  return `${owner}/${name}`.toLowerCase();
}

function jobActive(jobId) {
  return new AppError('JOB_ACTIVE', 'This repository is already being analyzed.', { jobId });
}

/**
 * Repository data access and the add flow (spec 7.5). Every query is scoped to the user.
 * @param {import('pg').Pool} pool
 */
export function createRepositoryService(pool) {
  /** @param {string} userId */
  async function list(userId) {
    const { rows } = await pool.query(
      `${REPO_SELECT} WHERE r.user_id = $1 ORDER BY r.created_at DESC, r.id DESC`,
      [userId],
    );
    return rows.map(mapRepository);
  }

  /**
   * @param {string} userId
   * @param {string} repoId
   * @returns {Promise<object>} the Repository; throws NOT_FOUND (also for another user's)
   */
  async function get(userId, repoId) {
    const { rows } = await pool.query(`${REPO_SELECT} WHERE r.id = $1 AND r.user_id = $2`, [
      repoId,
      userId,
    ]);
    if (rows.length === 0) throw new AppError('NOT_FOUND', 'Repository not found.');
    return mapRepository(rows[0]);
  }

  /**
   * Lowercase "owner/name" keys of the user's repositories, for the `alreadyAdded` flag.
   * @param {string} userId
   * @returns {Promise<Set<string>>}
   */
  async function addedKeys(userId) {
    const { rows } = await pool.query('SELECT owner, name FROM repositories WHERE user_id = $1', [
      userId,
    ]);
    return new Set(rows.map((r) => repoKey(r.owner, r.name)));
  }

  /**
   * Spec 7.5 steps 3-4 in one transaction. `meta` is the already-checked public metadata.
   * @param {string} userId
   * @param {{ id: number, owner: string, name: string, defaultBranch: string }} meta
   * @returns {Promise<{ repository: object, job: object }>}
   */
  async function addOrRetry(userId, meta) {
    const owner = meta.owner.toLowerCase();
    const name = meta.name.toLowerCase();
    const displayName = `${meta.owner}/${meta.name}`;
    const client = await pool.connect();
    let repoId;
    try {
      await client.query('BEGIN');
      // Creates the row if absent; a concurrent insert waits for the other transaction.
      await client.query(
        `INSERT INTO repositories (user_id, github_repo_id, owner, name, display_name, default_branch, visibility)
         VALUES ($1, $2, $3, $4, $5, $6, 'public')
         ON CONFLICT (user_id, owner, name) DO NOTHING`,
        [userId, meta.id, owner, name, displayName, meta.defaultBranch],
      );
      const { rows } = await client.query(
        `SELECT id, status FROM repositories WHERE user_id = $1 AND owner = $2 AND name = $3 FOR UPDATE`,
        [userId, owner, name],
      );
      const repo = rows[0];
      repoId = repo.id;
      if (repo.status === 'ready') {
        throw new AppError('REPO_ALREADY_ANALYZED', "You've already analyzed this repository.", {
          repositoryId: repo.id,
        });
      }
      const active = await client.query(
        `SELECT id FROM ingestion_jobs WHERE repository_id = $1 AND status IN ('queued', 'running')`,
        [repo.id],
      );
      if (active.rowCount > 0) throw jobActive(active.rows[0].id);

      await client.query(
        `UPDATE repositories SET status = 'analyzing', github_repo_id = $2, display_name = $3, default_branch = $4
         WHERE id = $1`,
        [repo.id, meta.id, displayName, meta.defaultBranch],
      );
      await client.query(
        `INSERT INTO ingestion_jobs (repository_id, job_type) VALUES ($1, 'initial')`,
        [repo.id],
      );
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      // The one-active-job index fired: another request won the race.
      if (err?.code === '23505' && err.constraint === 'one_active_job_per_repo') {
        const { rows } = await pool.query(
          `SELECT id FROM ingestion_jobs WHERE repository_id = $1 AND status IN ('queued', 'running')`,
          [repoId],
        );
        throw jobActive(rows[0]?.id ?? null);
      }
      throw err;
    } finally {
      client.release();
    }
    // Read after the connection is released, so one request never holds two.
    const repository = await get(userId, repoId);
    return { repository, job: repository.latestJob };
  }

  return { list, get, addedKeys, addOrRetry };
}
