import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { randomBytes } from 'node:crypto';
import { createApp } from '../../src/app.js';
import { AppError } from '../../src/errors/AppError.js';
import { tokenCryptoFromConfig } from '../../src/services/auth/tokenCrypto.js';
import { hasTestDb, resetTestDatabase } from '../helpers/db.js';

const config = {
  NODE_ENV: 'test',
  APP_ORIGIN: 'http://localhost:5173',
  TRUST_PROXY_HOPS: 1,
  SESSION_SECRET: randomBytes(32).toString('hex'),
  TOKEN_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
  TOKEN_KEY_ID: 1,
  MAX_ZIP_BYTES: 1000,
};

const oauth = {
  authorizeUrl: (state) => `https://github.com/login/oauth/authorize?state=${state}`,
  exchangeCode: vi.fn(),
  fetchUser: vi.fn(),
};
const github = { getRepository: vi.fn(), listUserRepositories: vi.fn() };
const enqueue = vi.fn();

const meta = (over = {}) => ({
  id: 1,
  private: false,
  defaultBranch: 'main',
  owner: 'Darkness947',
  name: 'Vigilante-Resume-Tailor',
  ...over,
});

describe.skipIf(!hasTestDb)('repository endpoints (integration, test database)', () => {
  let pool;
  let app;
  let cookieA;
  let cookieB;
  const crypto = tokenCryptoFromConfig(config);

  const cookieOf = (res) =>
    (res.headers['set-cookie'] ?? []).find((c) => c.startsWith('gc.sid='))?.split(';')[0];

  async function signIn(ghId) {
    oauth.exchangeCode.mockResolvedValue({ token: `gho_${ghId}`, scopes: '' });
    oauth.fetchUser.mockResolvedValue({ id: ghId, login: `user${ghId}`, avatarUrl: null });
    const start = await request(app).get('/api/auth/github');
    const state = new URL(start.headers.location).searchParams.get('state');
    const cb = await request(app)
      .get(`/api/auth/github/callback?code=abc&state=${state}`)
      .set('Cookie', cookieOf(start));
    return cookieOf(cb);
  }

  const post = (cookie, repo) =>
    request(app).post('/api/repos').set('Cookie', cookie).send({ repo });

  beforeAll(async () => {
    pool = await resetTestDatabase();
    app = createApp(config, {
      pool,
      oauth,
      crypto,
      github,
      enqueue,
      addRepoLimit: { windowMs: 60_000, limit: 1000 },
    });
    cookieA = await signIn(201);
    cookieB = await signIn(202);
  });
  afterAll(async () => {
    await pool?.end();
  });
  beforeEach(async () => {
    github.getRepository.mockReset().mockResolvedValue(meta());
    github.listUserRepositories.mockReset();
    enqueue.mockReset();
    await pool.query('DELETE FROM repositories');
  });

  it('requires a session on every route', async () => {
    for (const [method, path] of [
      ['get', '/api/github/repos'],
      ['get', '/api/repos'],
      ['post', '/api/repos'],
      ['get', '/api/repos/00000000-0000-4000-8000-000000000000'],
    ]) {
      const res = await request(app)[method](path);
      expect(res.status).toBe(401);
    }
  });

  describe('POST /api/repos', () => {
    it('creates the repository and a queued job, stores lowercase names, enqueues (202)', async () => {
      const res = await post(cookieA, 'Darkness947/Vigilante-Resume-Tailor');
      expect(res.status).toBe(202);
      expect(res.body.repository).toMatchObject({
        owner: 'darkness947',
        name: 'vigilante-resume-tailor',
        displayName: 'Darkness947/Vigilante-Resume-Tailor',
        status: 'analyzing',
        fileCount: null,
      });
      expect(res.body.job).toMatchObject({ status: 'queued', phase: null, filesProcessed: 0 });
      expect(res.body.repository.latestJob.id).toBe(res.body.job.id);
      expect(enqueue).toHaveBeenCalledExactlyOnceWith(res.body.job.id);
      expect(github.getRepository).toHaveBeenCalledWith(
        'gho_201',
        'Darkness947',
        'Vigilante-Resume-Tailor',
      );
      const { rows } = await pool.query('SELECT job_type FROM ingestion_jobs');
      expect(rows).toEqual([{ job_type: 'initial' }]);
    });

    it('accepts a github.com URL', async () => {
      const res = await post(cookieA, 'https://github.com/Darkness947/Vigilante-Resume-Tailor');
      expect(res.status).toBe(202);
    });

    it.each([undefined, '', 'nonsense', 'a/b/c', 'https://evil.com/a/b', 42])(
      'rejects invalid input %j with VALIDATION_ERROR',
      async (repo) => {
        const res = await post(cookieA, repo);
        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe('VALIDATION_ERROR');
        expect(res.body.error.message).toBe(
          'Enter a repository as owner/name or a github.com link.',
        );
        expect(github.getRepository).not.toHaveBeenCalled();
      },
    );

    it('private repository: 422 REPO_PRIVATE_NOT_SUPPORTED, nothing stored', async () => {
      github.getRepository.mockResolvedValue(meta({ private: true }));
      const res = await post(cookieA, 'a/b');
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('REPO_PRIVATE_NOT_SUPPORTED');
      expect((await pool.query('SELECT 1 FROM repositories')).rowCount).toBe(0);
      expect(enqueue).not.toHaveBeenCalled();
    });

    it('not found on GitHub: 404 REPO_NOT_FOUND_ON_GITHUB', async () => {
      github.getRepository.mockRejectedValue(new AppError('REPO_NOT_FOUND_ON_GITHUB', 'nope'));
      const res = await post(cookieA, 'a/b');
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('REPO_NOT_FOUND_ON_GITHUB');
    });

    it('GitHub failure: 502 GITHUB_UNAVAILABLE', async () => {
      github.getRepository.mockRejectedValue(new AppError('GITHUB_UNAVAILABLE', 'down'));
      const res = await post(cookieA, 'a/b');
      expect(res.status).toBe(502);
      expect(res.body.error.code).toBe('GITHUB_UNAVAILABLE');
    });

    it('already ready: 409 REPO_ALREADY_ANALYZED with repositoryId', async () => {
      const first = await post(cookieA, 'a/b');
      await pool.query(`UPDATE ingestion_jobs SET status = 'succeeded'`);
      await pool.query(`UPDATE repositories SET status = 'ready'`);
      const res = await post(cookieA, 'A/B');
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('REPO_ALREADY_ANALYZED');
      expect(res.body.error.repositoryId).toBe(first.body.repository.id);
      expect(enqueue).toHaveBeenCalledTimes(1);
    });

    it.each(['queued', 'running'])('job %s: 409 JOB_ACTIVE with jobId', async (status) => {
      const first = await post(cookieA, 'a/b');
      await pool.query('UPDATE ingestion_jobs SET status = $1', [status]);
      const res = await post(cookieA, 'a/b');
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('JOB_ACTIVE');
      expect(res.body.error.jobId).toBe(first.body.job.id);
      expect(res.body.error.message).toBe('This repository is already being analyzed.');
      expect(enqueue).toHaveBeenCalledTimes(1);
    });

    it('failed: creates a new job, status analyzing, 202', async () => {
      const first = await post(cookieA, 'a/b');
      await pool.query(
        `UPDATE ingestion_jobs SET status = 'failed', error_code = 'DOWNLOAD_FAILED'`,
      );
      await pool.query(`UPDATE repositories SET status = 'failed'`);
      const res = await post(cookieA, 'a/b');
      expect(res.status).toBe(202);
      expect(res.body.repository.id).toBe(first.body.repository.id);
      expect(res.body.repository.status).toBe('analyzing');
      expect(res.body.job.id).not.toBe(first.body.job.id);
      expect(res.body.job.status).toBe('queued');
      expect((await pool.query('SELECT 1 FROM ingestion_jobs')).rowCount).toBe(2);
      expect(enqueue).toHaveBeenCalledTimes(2);
    });

    it('concurrent requests: one 202 and one 409, a single job', async () => {
      const results = await Promise.all([post(cookieA, 'a/b'), post(cookieA, 'a/b')]);
      expect(results.map((r) => r.status).sort()).toEqual([202, 409]);
      expect(results.find((r) => r.status === 409).body.error.code).toBe('JOB_ACTIVE');
      expect((await pool.query('SELECT 1 FROM ingestion_jobs')).rowCount).toBe(1);
      expect(enqueue).toHaveBeenCalledTimes(1);
    });

    it('limits additions per window (429 RATE_LIMITED)', async () => {
      const limited = createApp(config, {
        pool,
        oauth,
        crypto,
        github,
        enqueue,
        addRepoLimit: { windowMs: 60_000, limit: 2 },
      });
      const send = () =>
        request(limited).post('/api/repos').set('Cookie', cookieA).send({ repo: 'bad' });
      expect((await send()).status).toBe(400);
      expect((await send()).status).toBe(400);
      const res = await send();
      expect(res.status).toBe(429);
      expect(res.body.error.code).toBe('RATE_LIMITED');
      expect(res.body.error.retryAfterSeconds).toBeGreaterThan(0);
      expect(res.body.error.message).toMatch(
        /^You're doing that too often\. Try again in \d+ seconds\.$/,
      );
    });
  });

  describe('GET /api/repos and /api/repos/:id', () => {
    it('lists newest first with the Repository and Job shapes', async () => {
      github.getRepository.mockResolvedValueOnce(meta({ owner: 'x', name: 'one' }));
      await post(cookieA, 'x/one');
      github.getRepository.mockResolvedValueOnce(meta({ id: 2, owner: 'x', name: 'two' }));
      await post(cookieA, 'x/two');
      const res = await request(app).get('/api/repos').set('Cookie', cookieA);
      expect(res.status).toBe(200);
      expect(res.body.items.map((r) => r.name)).toEqual(['two', 'one']);
      expect(Object.keys(res.body.items[0]).sort()).toEqual(
        [
          'displayName',
          'edgeCount',
          'fileCount',
          'id',
          'ingestionMs',
          'languageSummary',
          'lastIngestedAt',
          'latestJob',
          'name',
          'owner',
          'status',
        ].sort(),
      );
      expect(Object.keys(res.body.items[0].latestJob).sort()).toEqual(
        [
          'errorCode',
          'errorMessage',
          'filesProcessed',
          'filesSkipped',
          'filesTotal',
          'id',
          'phase',
          'report',
          'status',
        ].sort(),
      );
    });

    it('returns one repository and 400 for a non-UUID id', async () => {
      const added = await post(cookieA, 'a/b');
      const res = await request(app)
        .get(`/api/repos/${added.body.repository.id}`)
        .set('Cookie', cookieA);
      expect(res.status).toBe(200);
      expect(res.body.id).toBe(added.body.repository.id);
      const bad = await request(app).get('/api/repos/not-a-uuid').set('Cookie', cookieA);
      expect(bad.status).toBe(400);
    });

    it('ownership: user B gets 404 on user A repository and does not list it', async () => {
      const added = await post(cookieA, 'a/b');
      const res = await request(app)
        .get(`/api/repos/${added.body.repository.id}`)
        .set('Cookie', cookieB);
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
      const list = await request(app).get('/api/repos').set('Cookie', cookieB);
      expect(list.body.items).toEqual([]);
    });

    it('user B can add the same owner/name as a separate repository', async () => {
      const a = await post(cookieA, 'a/b');
      const b = await post(cookieB, 'a/b');
      expect(b.status).toBe(202);
      expect(b.body.repository.id).not.toBe(a.body.repository.id);
    });
  });

  describe('GET /api/jobs/:jobId', () => {
    it('returns the Job object for the owner', async () => {
      const added = await post(cookieA, 'a/b');
      const res = await request(app).get(`/api/jobs/${added.body.job.id}`).set('Cookie', cookieA);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        id: added.body.job.id,
        status: 'queued',
        phase: null,
        filesTotal: null,
        filesProcessed: 0,
        filesSkipped: 0,
        errorCode: null,
        errorMessage: null,
        report: null,
      });
    });

    it('reflects a failed job with its code and message', async () => {
      const added = await post(cookieA, 'a/b');
      await pool.query(
        `UPDATE ingestion_jobs SET status = 'failed', error_code = 'INTERRUPTED',
           error_message = 'Analysis was interrupted by a server restart. Try again.' WHERE id = $1`,
        [added.body.job.id],
      );
      const res = await request(app).get(`/api/jobs/${added.body.job.id}`).set('Cookie', cookieA);
      expect(res.body).toMatchObject({
        status: 'failed',
        errorCode: 'INTERRUPTED',
        errorMessage: 'Analysis was interrupted by a server restart. Try again.',
      });
    });

    it('ownership: user B gets 404 NOT_FOUND on user A job', async () => {
      const added = await post(cookieA, 'a/b');
      const res = await request(app).get(`/api/jobs/${added.body.job.id}`).set('Cookie', cookieB);
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });

    it('404 for an unknown id, 400 for a non-UUID id, 401 without a session', async () => {
      const unknown = await request(app)
        .get('/api/jobs/00000000-0000-4000-8000-000000000000')
        .set('Cookie', cookieA);
      expect(unknown.status).toBe(404);
      const bad = await request(app).get('/api/jobs/not-a-uuid').set('Cookie', cookieA);
      expect(bad.status).toBe(400);
      expect(bad.body.error.code).toBe('VALIDATION_ERROR');
      const anon = await request(app).get('/api/jobs/00000000-0000-4000-8000-000000000000');
      expect(anon.status).toBe(401);
    });
  });

  describe('GET /api/github/repos', () => {
    const raw = (name, owner = 'Darkness947') => ({
      owner: { login: owner },
      name,
      full_name: `${owner}/${name}`,
      description: 'd',
      language: 'TypeScript',
      default_branch: 'main',
      updated_at: '2026-11-01T00:00:00Z',
    });

    it('maps items, flags alreadyAdded case-insensitively, nextPage null under 30', async () => {
      await post(cookieA, 'Darkness947/Vigilante-Resume-Tailor');
      github.listUserRepositories.mockResolvedValue([raw('vigilante-resume-tailor'), raw('other')]);
      const res = await request(app).get('/api/github/repos').set('Cookie', cookieA);
      expect(res.status).toBe(200);
      expect(github.listUserRepositories).toHaveBeenCalledWith('gho_201', 1);
      expect(res.body.nextPage).toBeNull();
      expect(res.body.items[0]).toEqual({
        owner: 'Darkness947',
        name: 'vigilante-resume-tailor',
        fullName: 'Darkness947/vigilante-resume-tailor',
        description: 'd',
        language: 'TypeScript',
        defaultBranch: 'main',
        updatedAt: '2026-11-01T00:00:00Z',
        alreadyAdded: true,
      });
      expect(res.body.items[1].alreadyAdded).toBe(false);
    });

    it('alreadyAdded is per user', async () => {
      await post(cookieA, 'Darkness947/Vigilante-Resume-Tailor');
      github.listUserRepositories.mockResolvedValue([raw('vigilante-resume-tailor')]);
      const res = await request(app).get('/api/github/repos').set('Cookie', cookieB);
      expect(res.body.items[0].alreadyAdded).toBe(false);
    });

    it('nextPage is page + 1 when a full page of 30 comes back', async () => {
      github.listUserRepositories.mockResolvedValue(
        Array.from({ length: 30 }, (_, i) => raw(`r${i}`)),
      );
      const res = await request(app).get('/api/github/repos?page=2').set('Cookie', cookieA);
      expect(github.listUserRepositories).toHaveBeenCalledWith('gho_201', 2);
      expect(res.body.nextPage).toBe(3);
    });

    it('nextPage is null at the last accepted page, even when the page is full', async () => {
      github.listUserRepositories.mockResolvedValue(
        Array.from({ length: 30 }, (_, i) => raw(`r${i}`)),
      );
      const res = await request(app).get('/api/github/repos?page=10000').set('Cookie', cookieA);
      expect(res.status).toBe(200);
      expect(res.body.nextPage).toBeNull();
    });

    it.each(['0', '-1', 'abc', '1.5', '10001'])('rejects page=%s with 400', async (page) => {
      const res = await request(app).get(`/api/github/repos?page=${page}`).set('Cookie', cookieA);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.details[0].message).toBe('page must be a whole number from 1 to 10000');
    });
  });
});
