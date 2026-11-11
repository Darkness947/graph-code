import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import request from 'supertest';
import { randomBytes } from 'node:crypto';
import { createApp } from '../../src/app.js';
import { tokenCryptoFromConfig, getUserToken } from '../../src/services/auth/tokenCrypto.js';
import { hasTestDb, resetTestDatabase } from '../helpers/db.js';

const config = {
  NODE_ENV: 'test',
  APP_ORIGIN: 'http://localhost:5173',
  TRUST_PROXY_HOPS: 1,
  SESSION_SECRET: randomBytes(32).toString('hex'),
  TOKEN_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
  TOKEN_KEY_ID: 1,
};

const oauth = {
  authorizeUrl: (state) => `https://github.com/login/oauth/authorize?state=${state}`,
  exchangeCode: vi.fn(),
  fetchUser: vi.fn(),
};

describe.skipIf(!hasTestDb)('auth (integration, test database)', () => {
  let pool;
  let app;
  const crypto = tokenCryptoFromConfig(config);

  beforeAll(async () => {
    pool = await resetTestDatabase();
    app = createApp(config, { pool, oauth, crypto });
  });
  afterAll(async () => {
    await pool?.end();
  });

  const cookieOf = (res) =>
    (res.headers['set-cookie'] ?? []).find((c) => c.startsWith('gc.sid='))?.split(';')[0];

  const sidOf = (cookie) => decodeURIComponent(cookie.split('=')[1]).slice(2).split('.')[0];
  const sessionRows = async (cookie) =>
    (await pool.query('SELECT 1 FROM session WHERE sid = $1', [sidOf(cookie)])).rowCount;
  const clearsCookie = (res) =>
    /gc\.sid=;.*HttpOnly.*SameSite=Lax/i.test(res.headers['set-cookie'].join(';'));

  /** Starts sign-in and returns the agent cookie and the state GitHub would echo back. */
  async function begin() {
    const res = await request(app).get('/api/auth/github');
    expect(res.status).toBe(302);
    const state = new URL(res.headers.location).searchParams.get('state');
    return { cookie: cookieOf(res), state, res };
  }

  async function signIn(ghId = 101) {
    oauth.exchangeCode.mockResolvedValue({ token: `gho_token_${ghId}`, scopes: '' });
    oauth.fetchUser.mockResolvedValue({ id: ghId, login: `user${ghId}`, avatarUrl: 'http://a/1' });
    const { cookie, state } = await begin();
    const cb = await request(app)
      .get(`/api/auth/github/callback?code=abc&state=${state}`)
      .set('Cookie', cookie);
    return { cb, oldCookie: cookie, cookie: cookieOf(cb) };
  }

  it('starts sign-in: redirects to GitHub with a 64-hex state and a session cookie', async () => {
    const { res, state, cookie } = await begin();
    expect(res.headers.location).toMatch(/^https:\/\/github\.com\/login\/oauth\/authorize\?/);
    expect(state).toMatch(/^[0-9a-f]{64}$/);
    expect(cookie).toBeTruthy();
    const cookieHeader = res.headers['set-cookie'][0];
    expect(cookieHeader).toMatch(/HttpOnly/i);
    expect(cookieHeader).toMatch(/SameSite=Lax/i);
  });

  it('401 on a protected route without a session', async () => {
    const res = await request(app).get('/api/me');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('signs in: redirects to /dashboard, regenerates the session, stores it in the table', async () => {
    const { cb, oldCookie, cookie } = await signIn(101);
    expect(cb.status).toBe(302);
    expect(cb.headers.location).toBe('/dashboard');
    expect(cookie).toBeTruthy();
    expect(cookie).not.toBe(oldCookie);

    const sid = decodeURIComponent(cookie.split('=')[1]).slice(2).split('.')[0];
    const { rows } = await pool.query('SELECT sess FROM session WHERE sid = $1', [sid]);
    expect(rows).toHaveLength(1);
    expect(rows[0].sess.userId).toBeTruthy();
    expect(rows[0].sess.oauthState).toBeUndefined();
    // The pre-login session id no longer exists.
    const oldSid = decodeURIComponent(oldCookie.split('=')[1]).slice(2).split('.')[0];
    expect((await pool.query('SELECT 1 FROM session WHERE sid = $1', [oldSid])).rowCount).toBe(0);
  });

  it('stores the token encrypted and updates (not duplicates) the user on a second login', async () => {
    await signIn(102);
    await signIn(102);
    const { rows } = await pool.query(
      'SELECT id, github_login, access_token_enc, last_login_at FROM users WHERE github_id = 102',
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].last_login_at).toBeTruthy();
    expect(rows[0].access_token_enc.includes(Buffer.from('gho_token_102'))).toBe(false);
    expect(await getUserToken(pool, crypto, rows[0].id)).toBe('gho_token_102');

    // Tampering with the stored value makes decryption fail.
    const bad = Buffer.from(rows[0].access_token_enc);
    bad[bad.length - 1] ^= 1;
    await pool.query('UPDATE users SET access_token_enc = $1 WHERE id = $2', [bad, rows[0].id]);
    await expect(getUserToken(pool, crypto, rows[0].id)).rejects.toThrow();
  });

  it('GET /api/me returns the signed-in user and never the token', async () => {
    const { cookie } = await signIn(103);
    const res = await request(app).get('/api/me').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      id: expect.any(String),
      login: 'user103',
      avatarUrl: 'http://a/1',
      aiNoticeAcknowledged: false,
    });
    expect(JSON.stringify(res.body)).not.toContain('gho_');
  });

  it('POST /api/me/ai-notice records the acknowledgement', async () => {
    const { cookie } = await signIn(104);
    expect((await request(app).post('/api/me/ai-notice').set('Cookie', cookie)).status).toBe(204);
    const me = await request(app).get('/api/me').set('Cookie', cookie);
    expect(me.body.aiNoticeAcknowledged).toBe(true);
  });

  it('a mismatched state redirects to state_mismatch and exchanges nothing', async () => {
    oauth.exchangeCode.mockClear();
    const { cookie } = await begin();
    const wrong = 'f'.repeat(64);
    const res = await request(app)
      .get(`/api/auth/github/callback?code=abc&state=${wrong}`)
      .set('Cookie', cookie);
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/error?code=state_mismatch');
    expect(oauth.exchangeCode).not.toHaveBeenCalled();
    expect(await sessionRows(cookie)).toBe(0);
    expect(clearsCookie(res)).toBe(true);
  });

  it('a missing state, or a callback with no session, redirects to state_mismatch', async () => {
    const { cookie } = await begin();
    const noState = await request(app)
      .get('/api/auth/github/callback?code=abc')
      .set('Cookie', cookie);
    expect(noState.headers.location).toBe('/error?code=state_mismatch');
    const noSession = await request(app).get('/api/auth/github/callback?code=abc&state=zz');
    expect(noSession.headers.location).toBe('/error?code=state_mismatch');
  });

  it('cancel on GitHub redirects to access_denied and ends the session', async () => {
    const { cookie } = await begin();
    const res = await request(app)
      .get('/api/auth/github/callback?error=access_denied')
      .set('Cookie', cookie);
    expect(res.headers.location).toBe('/error?code=access_denied');
    expect(await sessionRows(cookie)).toBe(0);
    expect(clearsCookie(res)).toBe(true);
  });

  it('a failed code exchange redirects to oauth_failed and creates no user', async () => {
    oauth.exchangeCode.mockRejectedValue(new Error('bad_verification_code'));
    const before = (await pool.query('SELECT count(*)::int AS n FROM users')).rows[0].n;
    const { cookie, state } = await begin();
    const res = await request(app)
      .get(`/api/auth/github/callback?code=bad&state=${state}`)
      .set('Cookie', cookie);
    expect(res.headers.location).toBe('/error?code=oauth_failed');
    expect((await pool.query('SELECT count(*)::int AS n FROM users')).rows[0].n).toBe(before);
    expect(await sessionRows(cookie)).toBe(0);
    expect(clearsCookie(res)).toBe(true);
  });

  it('a callback replayed with the old cookie after sign-in is rejected', async () => {
    const { cookie, state } = await begin();
    oauth.exchangeCode.mockResolvedValue({ token: 't', scopes: '' });
    oauth.fetchUser.mockResolvedValue({ id: 105, login: 'user105', avatarUrl: null });
    await request(app).get(`/api/auth/github/callback?code=a&state=${state}`).set('Cookie', cookie);
    const again = await request(app)
      .get(`/api/auth/github/callback?code=a&state=${state}`)
      .set('Cookie', cookie);
    expect(again.headers.location).toBe('/error?code=state_mismatch');
  });

  it('issues a 24 hour cookie and refreshes it on each request (rolling)', async () => {
    const { cookie, res } = await begin();
    const header = res.headers['set-cookie'][0];
    expect(header).toMatch(/Path=\//);
    const first = new Date(header.match(/Expires=([^;]+)/)[1]).getTime();
    expect(first - Date.now()).toBeGreaterThan(23.9 * 3600 * 1000);
    expect(first - Date.now()).toBeLessThanOrEqual(24 * 3600 * 1000 + 2000);
    await new Promise((r) => setTimeout(r, 1100));
    const again = await request(app).get('/api/auth/github').set('Cookie', cookie);
    const next = new Date(again.headers['set-cookie'][0].match(/Expires=([^;]+)/)[1]).getTime();
    expect(next).toBeGreaterThan(first);
  });

  it('a database failure during sign-in redirects to oauth_failed and ends the session', async () => {
    const flaky = {
      query: (sql, ...rest) =>
        /INSERT INTO users/.test(sql)
          ? Promise.reject(new Error('db down'))
          : pool.query(sql, ...rest),
    };
    const flakyApp = createApp(config, { pool: flaky, oauth, crypto });
    oauth.exchangeCode.mockResolvedValue({ token: 't', scopes: '' });
    oauth.fetchUser.mockResolvedValue({ id: 108, login: 'user108', avatarUrl: null });
    const start = await request(flakyApp).get('/api/auth/github');
    const state = new URL(start.headers.location).searchParams.get('state');
    const cookie = cookieOf(start);
    const res = await request(flakyApp)
      .get(`/api/auth/github/callback?code=a&state=${state}`)
      .set('Cookie', cookie);
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/error?code=oauth_failed');
    expect(await sessionRows(cookie)).toBe(0);
  });

  it('logout destroys the session server-side and invalidates the cookie', async () => {
    const { cookie } = await signIn(106);
    expect((await request(app).get('/api/me').set('Cookie', cookie)).status).toBe(200);

    const out = await request(app).post('/api/auth/logout').set('Cookie', cookie);
    expect(out.status).toBe(204);
    expect(clearsCookie(out)).toBe(true);

    const sid = decodeURIComponent(cookie.split('=')[1]).slice(2).split('.')[0];
    expect((await pool.query('SELECT 1 FROM session WHERE sid = $1', [sid])).rowCount).toBe(0);
    // The old cookie, replayed, is no longer accepted.
    expect((await request(app).get('/api/me').set('Cookie', cookie)).status).toBe(401);
  });

  it('logout without a session is still 204', async () => {
    expect((await request(app).post('/api/auth/logout')).status).toBe(204);
  });

  it('a session whose user no longer exists gets 401 and is destroyed', async () => {
    const { cookie } = await signIn(107);
    await pool.query('DELETE FROM users WHERE github_id = 107');
    const res = await request(app).get('/api/me').set('Cookie', cookie);
    expect(res.status).toBe(401);
    const sid = decodeURIComponent(cookie.split('=')[1]).slice(2).split('.')[0];
    expect((await pool.query('SELECT 1 FROM session WHERE sid = $1', [sid])).rowCount).toBe(0);
  });

  it('unknown /api routes are still 404, not 401', async () => {
    const res = await request(app).get('/api/nope');
    expect(res.status).toBe(404);
  });
});
