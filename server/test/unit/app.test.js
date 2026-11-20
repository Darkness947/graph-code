import { describe, it, expect, vi, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { body } from 'express-validator';
import { createApp } from '../../src/app.js';
import { createErrorHandler, notFoundHandler } from '../../src/middleware/errors.js';
import { attachRequestId } from '../../src/middleware/security.js';
import { validateRequest, uuidParam, repoInputBody } from '../../src/middleware/validate.js';
import { AppError } from '../../src/errors/AppError.js';
import { ERROR_STATUS } from '../../src/errors/codes.js';
import { cookieOptions } from '../../src/middleware/session.js';
import {
  rateLimitKey,
  createInFlightLock,
  STALE_HOLD_MS,
  GLOBAL_LIMIT,
  ADD_REPO_LIMIT,
  ANALYZE_LIMIT,
} from '../../src/middleware/rateLimits.js';

const config = {
  NODE_ENV: 'test',
  APP_ORIGIN: 'http://localhost:5173',
  TRUST_PROXY_HOPS: 1,
};

afterEach(() => vi.restoreAllMocks());

describe('GET /api/health', () => {
  it('returns 200 {"status":"ok"}', async () => {
    const res = await request(createApp(config)).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });
});

describe('unknown routes', () => {
  it.each(['/api/nope', '/nope', '/api/repos/xyz/deep/path'])(
    '%s returns 404 NOT_FOUND in the standard error shape',
    async (path) => {
      const res = await request(createApp(config)).get(path);
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
      expect(typeof res.body.error.message).toBe('string');
      expect(res.body.error.requestId).toBe(res.headers['x-request-id']);
    },
  );

  it('also returns 404 for a POST to an unknown route', async () => {
    const res = await request(createApp(config)).post('/api/nope').send({});
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});

describe('security middleware', () => {
  it('sets helmet headers and hides x-powered-by', async () => {
    const res = await request(createApp(config)).get('/api/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('allows CORS with credentials for the app origin only', async () => {
    const app = createApp(config);
    const ok = await request(app).get('/api/health').set('Origin', 'http://localhost:5173');
    expect(ok.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    expect(ok.headers['access-control-allow-credentials']).toBe('true');
    const other = await request(app).get('/api/health').set('Origin', 'https://evil.example');
    expect(other.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    expect(other.headers['access-control-allow-origin']).not.toBe('https://evil.example');
  });

  it('applies trust proxy from the configuration', () => {
    expect(createApp({ ...config, TRUST_PROXY_HOPS: 2 }).get('trust proxy')).toBe(2);
  });

  it('rejects a JSON body over 100kb with VALIDATION_ERROR', async () => {
    const res = await request(createApp(config))
      .post('/api/health')
      .send({ big: 'x'.repeat(120 * 1024) });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects malformed JSON with VALIDATION_ERROR and no parser detail', async () => {
    const res = await request(createApp(config))
      .post('/api/health')
      .set('Content-Type', 'application/json')
      .send('{"a": ');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(JSON.stringify(res.body)).not.toMatch(/Unexpected|position|SyntaxError/);
  });

  it('answers 429 RATE_LIMITED with retryAfterSeconds beyond the limit', async () => {
    const app = createApp(config, { globalLimit: { windowMs: 60_000, limit: 2 } });
    await request(app).get('/api/health');
    await request(app).get('/api/health');
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe('RATE_LIMITED');
    expect(res.body.error.retryAfterSeconds).toBeGreaterThan(0);
  });
});

describe('session cookie options', () => {
  it('is secure only in production, always httpOnly and sameSite lax', () => {
    expect(cookieOptions({ NODE_ENV: 'production' })).toEqual({
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
    });
    expect(cookieOptions({ NODE_ENV: 'development' }).secure).toBe(false);
  });
});

describe('rate limiting', () => {
  it('is 300 requests per 15 minutes on /api (spec 7.1)', () => {
    expect(GLOBAL_LIMIT).toEqual({ windowMs: 15 * 60 * 1000, limit: 300 });
  });

  it('allows 5 repository additions per 10 minutes (spec 7.1)', () => {
    expect(ADD_REPO_LIMIT).toEqual({ windowMs: 10 * 60 * 1000, limit: 5 });
  });

  it('allows 10 analyses per minute (spec 7.1)', () => {
    expect(ANALYZE_LIMIT).toEqual({ windowMs: 60 * 1000, limit: 10 });
  });

  it('keys by user ID when signed in, otherwise by IP', () => {
    expect(rateLimitKey({ session: { userId: 'u-1' }, ip: '1.2.3.4' })).toBe('user:u-1');
    expect(rateLimitKey({ session: {}, ip: '1.2.3.4' })).toBe('ip:1.2.3.4');
    expect(rateLimitKey({ ip: '1.2.3.4' })).toBe('ip:1.2.3.4');
    expect(rateLimitKey({ ip: '5.6.7.8' })).not.toBe(rateLimitKey({ ip: '1.2.3.4' }));
  });

  it('groups IPv6 addresses of one /64 subnet together', () => {
    expect(rateLimitKey({ ip: '2001:db8:1:2:aaaa::1' })).toBe(
      rateLimitKey({ ip: '2001:db8:1:2:bbbb::9' }),
    );
  });

  it('counts each client IP separately', async () => {
    const app = createApp(
      { ...config, TRUST_PROXY_HOPS: 1 },
      { globalLimit: { windowMs: 60_000, limit: 1 } },
    );
    expect((await request(app).get('/api/health').set('X-Forwarded-For', '9.9.9.1')).status).toBe(
      200,
    );
    expect((await request(app).get('/api/health').set('X-Forwarded-For', '9.9.9.1')).status).toBe(
      429,
    );
    expect((await request(app).get('/api/health').set('X-Forwarded-For', '9.9.9.2')).status).toBe(
      200,
    );
  });
});

describe('central error handler', () => {
  function appThatThrows(error, cfg = config) {
    const app = express();
    app.use(attachRequestId);
    app.get('/boom', () => {
      throw error;
    });
    app.use(notFoundHandler);
    app.use(createErrorHandler(cfg));
    return app;
  }

  it('maps an AppError to its Part 6.1 status, message and extras', async () => {
    const err = new AppError('JOB_ACTIVE', 'An analysis is already running.', { jobId: 'j-1' });
    const res = await request(appThatThrows(err)).get('/boom');
    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({
      code: 'JOB_ACTIVE',
      message: 'An analysis is already running.',
      jobId: 'j-1',
    });
    expect(res.body.error.requestId).toBeTruthy();
  });

  it('still answers 401 when forgetting a rejected token fails, logging only the error name', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const err = Object.assign(new AppError('UNAUTHENTICATED', 'Please sign in to continue.'), {
      githubReason: 'TOKEN_REJECTED',
      githubStatus: 401,
    });
    const pool = {
      query: vi.fn().mockRejectedValue(new Error('connect to postgres://u:pw@h failed')),
    };
    const app = express();
    app.use(attachRequestId);
    app.get('/boom', (req) => {
      req.user = { id: 'user-1' };
      throw err;
    });
    app.use(createErrorHandler(config, { pool }));

    const res = await request(app).get('/boom');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
    const lines = log.mock.calls.map((c) => c.join(' ')).join(' ');
    expect(lines).toContain('could not end the session after a rejected token: Error');
    expect(lines).not.toContain('pw@h');
    log.mockRestore();
  });

  it('maps a plain Error to 500 INTERNAL without leaking its message or stack', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const err = new Error('SELECT * FROM users WHERE secret=hunter2 at /srv/app/db.js:12');
    const res = await request(appThatThrows(err)).get('/boom');
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL');
    const text = JSON.stringify(res.body);
    expect(text).not.toMatch(/SELECT|hunter2|\/srv\/app|at .*\.js|stack/i);
  });

  it('logs the cause with the request ID', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await request(appThatThrows(new Error('disk on fire'))).get('/boom');
    expect(spy).toHaveBeenCalledOnce();
    expect(spy.mock.calls[0][0]).toContain(res.body.error.requestId);
    expect(spy.mock.calls[0][0]).toContain('disk on fire');
  });

  it('in production logs only the error name and code, never message or stack', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const err = Object.assign(new Error('connect postgres://u:SECRETPW@host/db failed'), {
      code: 'ECONNREFUSED',
    });
    const res = await request(appThatThrows(err, { NODE_ENV: 'production' })).get('/boom');
    expect(res.status).toBe(500);
    const logged = spy.mock.calls[0][0];
    expect(logged).toContain('ECONNREFUSED');
    expect(logged).not.toContain('SECRETPW');
    expect(logged).not.toContain('postgres:');
    expect(logged).not.toContain('    at ');
  });

  it('maps other body-parser client errors (4xx, exposed) to VALIDATION_ERROR', async () => {
    const err = Object.assign(new Error('unsupported charset "UTF-7"'), {
      status: 415,
      type: 'charset.unsupported',
      expose: true,
    });
    const res = await request(appThatThrows(err)).get('/boom');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(JSON.stringify(res.body)).not.toContain('UTF-7');
  });

  it('does not treat a non-exposed 4xx or a 5xx error as a client error', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    for (const err of [
      Object.assign(new Error('x'), { status: 404 }),
      Object.assign(new Error('x'), { status: 503, expose: true }),
    ]) {
      const res = await request(appThatThrows(err)).get('/boom');
      expect(res.status).toBe(500);
      expect(res.body.error.code).toBe('INTERNAL');
    }
  });

  it('does not let extras overwrite code, message or requestId', async () => {
    const err = new AppError('JOB_ACTIVE', 'msg', { code: 'HACKED', message: 'x', requestId: 'y' });
    const res = await request(appThatThrows(err)).get('/boom');
    expect(res.body.error.code).toBe('JOB_ACTIVE');
    expect(res.body.error.message).toBe('msg');
    expect(res.body.error.requestId).not.toBe('y');
  });

  it('every Part 6.1 code is constructible with its status', () => {
    for (const [code, status] of Object.entries(ERROR_STATUS)) {
      expect(new AppError(code, 'm').status).toBe(status);
    }
    expect(() => new AppError('NOT_A_CODE', 'm')).toThrow();
  });
});

describe('validateRequest', () => {
  const app = express();
  app.use(attachRequestId);
  app.use(express.json());
  app.get('/items/:id', uuidParam('id'), validateRequest, (req, res) => res.json({ ok: true }));
  app.post('/repos', repoInputBody(), validateRequest, (req, res) => res.json({ ok: true }));
  app.post('/named', body('name').isLength({ min: 3 }), validateRequest, (req, res) =>
    res.json({ ok: true }),
  );
  app.use(createErrorHandler(config));

  it('passes valid input through', async () => {
    const id = '3f2b8c1e-9a4d-4e6f-8b1a-2c3d4e5f6a7b';
    expect((await request(app).get(`/items/${id}`)).status).toBe(200);
    expect((await request(app).post('/repos').send({ repo: 'vercel/next-learn' })).status).toBe(
      200,
    );
  });

  it('returns VALIDATION_ERROR with the failing fields in details', async () => {
    const res = await request(app).get('/items/not-a-uuid');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details).toEqual([{ field: 'id', message: 'id must be a UUID' }]);
    const repo = await request(app).post('/repos').send({ repo: 'https://evil.com/a/b' });
    expect(repo.status).toBe(400);
    expect(repo.body.error.details[0].field).toBe('repo');
  });

  it('never echoes the submitted value back', async () => {
    const res = await request(app).post('/named').send({ name: 'x' });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).not.toContain('"x"');
  });
});

describe('in-flight lock', () => {
  afterEach(() => vi.useRealTimers());

  /** Holds `key` until the returned `finish` is called; resolves with the run's promise. */
  function hold(lock, key) {
    const gate = Promise.withResolvers();
    const done = lock.run(key, () => gate.promise);
    return { done, finish: gate.resolve, fail: gate.reject };
  }

  it('refuses a second run for the same key until the first settles', async () => {
    const lock = createInFlightLock({ holdMs: 20_000 });
    const first = hold(lock, 'u-1');
    const fn = vi.fn();
    await expect(lock.run('u-1', fn)).rejects.toMatchObject({
      code: 'RATE_LIMITED',
      extras: { retryAfterSeconds: 20 },
      message: "You're doing that too often. Try again in 20 seconds.",
    });
    expect(fn).not.toHaveBeenCalled();
    first.finish('ok');
    await expect(first.done).resolves.toBe('ok');
    await expect(lock.run('u-1', async () => 'again')).resolves.toBe('again');
  });

  it('releases the key when the run fails', async () => {
    const lock = createInFlightLock({ holdMs: 20_000 });
    const first = hold(lock, 'u-1');
    first.fail(new Error('boom'));
    await expect(first.done).rejects.toThrow('boom');
    await expect(lock.run('u-1', async () => 'next')).resolves.toBe('next');
  });

  it('keeps keys independent', async () => {
    const lock = createInFlightLock({ holdMs: 20_000 });
    const first = hold(lock, 'u-1');
    await expect(lock.run('u-2', async () => 'other')).resolves.toBe('other');
    first.finish();
    await first.done;
  });

  it('counts retryAfterSeconds down to the end of the hold, never below 1', async () => {
    vi.useFakeTimers();
    const lock = createInFlightLock({ holdMs: 20_000 });
    const first = hold(lock, 'u-1');
    vi.advanceTimersByTime(7_500);
    await expect(lock.run('u-1', vi.fn())).rejects.toMatchObject({
      extras: { retryAfterSeconds: 13 },
    });
    vi.advanceTimersByTime(60_000);
    await expect(lock.run('u-1', vi.fn())).rejects.toMatchObject({
      extras: { retryAfterSeconds: 1 },
    });
    first.finish();
    await first.done;
  });

  it('frees a hold that never settled after staleMs, and the late run keeps the new hold', async () => {
    vi.useFakeTimers();
    const lock = createInFlightLock({ holdMs: 20_000, staleMs: 120_000 });
    const hung = hold(lock, 'u-1');
    vi.advanceTimersByTime(119_000);
    await expect(lock.run('u-1', vi.fn())).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    vi.advanceTimersByTime(1_000);
    const fresh = hold(lock, 'u-1');
    hung.finish();
    await hung.done;
    // The stale run settling must not release the fresh hold.
    await expect(lock.run('u-1', vi.fn())).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    fresh.finish();
    await fresh.done;
    await expect(lock.run('u-1', async () => 'free')).resolves.toBe('free');
  });

  it('frees stale holds after two minutes by default', () => {
    expect(STALE_HOLD_MS).toBe(2 * 60 * 1000);
  });
});
