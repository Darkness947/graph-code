import { getUserToken } from '../auth/tokenCrypto.js';
import { IngestionError } from './IngestionError.js';

/**
 * The fetching step (spec 7.5 step 1). Reads the head commit of the repository's default branch
 * once, then downloads the archive of exactly that commit, so everything later in the run (and
 * every later source request) refers to one pinned SHA. Leaves `ctx.commitSha` and `ctx.archive`.
 * Any failure here fails the job with DOWNLOAD_FAILED (the orchestrator's code for this phase),
 * except an archive over MAX_ZIP_BYTES, which fails with ARCHIVE_LIMIT_EXCEEDED.
 * @param {{ pool: import('pg').Pool,
 *   crypto: ReturnType<typeof import('../auth/tokenCrypto.js').createTokenCrypto>,
 *   github: Pick<ReturnType<typeof import('../github/githubClient.js').createGithubClient>,
 *     'getHeadCommit' | 'downloadArchive'> }} deps
 * @returns {import('./orchestrator.js').PipelineStep}
 */
export function createFetchingStep({ pool, crypto, github }) {
  return async function fetching(ctx) {
    // No signed-in user here: the job runs with the token of the repository's own owner.
    const { rows } = await pool.query(
      'SELECT user_id, owner, name, default_branch FROM repositories WHERE id = $1',
      [ctx.job.repositoryId],
    );
    if (rows.length === 0) throw new IngestionError('DOWNLOAD_FAILED', 'repository row is gone');
    const { user_id: userId, owner, name, default_branch: branch } = rows[0];

    const token = await getUserToken(pool, crypto, userId);
    if (!token) throw new IngestionError('DOWNLOAD_FAILED', 'the owner has no GitHub token');

    const sha = await github.getHeadCommit(token, owner, name, branch);
    ctx.commitSha = sha;
    try {
      ctx.archive = await github.downloadArchive(owner, name, sha);
    } catch (err) {
      // The client stops reading at MAX_ZIP_BYTES; a retry cannot help, so say so (user decision).
      if (err?.githubReason === 'TOO_LARGE') {
        throw new IngestionError('ARCHIVE_LIMIT_EXCEEDED', 'the archive is over the size limit');
      }
      throw err;
    }
  };
}
