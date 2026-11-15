import { describe, it, expect, vi } from 'vitest';
import { createFetchingStep } from '../../src/services/ingestion/fetcher.js';
import { IngestionOrchestrator, PHASES } from '../../src/services/ingestion/orchestrator.js';
import { AppError } from '../../src/errors/AppError.js';

const SHA = '0123456789abcdef0123456789abcdef01234567';
const REPO = { user_id: 'user-1', owner: 'octo', name: 'demo', default_branch: 'develop' };
const USER = { access_token_enc: Buffer.from('enc'), token_key_id: 1 };

function setup({ repo = REPO, user = USER, github = {} } = {}) {
  const pool = {
    query: vi.fn(async (sql) => ({
      rows: (sql.includes('FROM repositories') ? [repo] : [user]).filter(Boolean),
    })),
  };
  const crypto = { decrypt: vi.fn(() => 'gho_token') };
  const client = {
    getHeadCommit: vi.fn().mockResolvedValue(SHA),
    downloadArchive: vi.fn().mockResolvedValue(Buffer.from('zip')),
    ...github,
  };
  const step = createFetchingStep({ pool, crypto, github: client });
  return { pool, crypto, client, step, ctx: { job: { id: 'job-1', repositoryId: 'repo-1' } } };
}

/** Runs the step inside the orchestrator and returns the code the job failed with. */
async function failureCode(step) {
  const jobs = {
    start: vi.fn().mockResolvedValue({ id: 'job-1', repositoryId: 'repo-1', jobType: 'initial' }),
    setPhase: vi.fn().mockResolvedValue(true),
    fail: vi.fn().mockResolvedValue(true),
  };
  const steps = Object.fromEntries(PHASES.map((p) => [p, vi.fn()]));
  const logger = { error: vi.fn() };
  await new IngestionOrchestrator({ jobs, steps: { ...steps, fetching: step }, logger }).run(
    'job-1',
  );
  expect(steps.extracting).not.toHaveBeenCalled();
  return { code: jobs.fail.mock.calls[0][1], logged: logger.error.mock.calls.flat().join('\n') };
}

describe('fetching step: commit SHA pinning (AC1)', () => {
  it('downloads the archive of exactly the head SHA it read, and keeps the SHA', async () => {
    const { step, ctx, client } = setup();
    await step(ctx);
    expect(client.getHeadCommit).toHaveBeenCalledExactlyOnceWith(
      'gho_token',
      'octo',
      'demo',
      'develop',
    );
    expect(client.downloadArchive).toHaveBeenCalledExactlyOnceWith('octo', 'demo', SHA);
    expect(ctx.commitSha).toBe(SHA);
    expect(ctx.archive).toEqual(Buffer.from('zip'));
  });

  it('looks up the repository of the job and its owner with parameterized queries', async () => {
    const { step, ctx, pool } = setup();
    await step(ctx);
    expect(pool.query.mock.calls[0][1]).toEqual(['repo-1']);
    expect(pool.query.mock.calls[1][1]).toEqual(['user-1']);
  });
});

describe('fetching step: failures → DOWNLOAD_FAILED', () => {
  it('GitHub fails while reading the head commit; nothing is downloaded', async () => {
    const { step, client } = setup({
      github: {
        getHeadCommit: vi.fn().mockRejectedValue(new AppError('GITHUB_UNAVAILABLE', 'down')),
      },
    });
    expect((await failureCode(step)).code).toBe('DOWNLOAD_FAILED');
    expect(client.downloadArchive).not.toHaveBeenCalled();
  });

  it('the repository is gone from GitHub', async () => {
    const { step } = setup({
      github: {
        getHeadCommit: vi.fn().mockRejectedValue(new AppError('REPO_NOT_FOUND_ON_GITHUB', 'x')),
      },
    });
    expect((await failureCode(step)).code).toBe('DOWNLOAD_FAILED');
  });

  it('the archive download fails', async () => {
    const { step } = setup({
      github: { downloadArchive: vi.fn().mockRejectedValue(new Error('socket hang up')) },
    });
    expect((await failureCode(step)).code).toBe('DOWNLOAD_FAILED');
  });

  it('the owner has no stored token; GitHub is not called', async () => {
    const { step, client } = setup({ user: { access_token_enc: null, token_key_id: null } });
    expect((await failureCode(step)).code).toBe('DOWNLOAD_FAILED');
    expect(client.getHeadCommit).not.toHaveBeenCalled();
  });

  it('the repository row was deleted', async () => {
    const { step, client } = setup({ repo: null });
    expect((await failureCode(step)).code).toBe('DOWNLOAD_FAILED');
    expect(client.getHeadCommit).not.toHaveBeenCalled();
  });

  it('a failure after a successful token read does not log the token', async () => {
    const { step } = setup({
      github: { getHeadCommit: vi.fn().mockRejectedValue(new Error('timeout')) },
    });
    expect((await failureCode(step)).logged).not.toContain('gho_token');
  });
});
