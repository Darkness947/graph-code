import request from 'supertest';

/**
 * The `gc.sid=…` session cookie a response sets, if any.
 * @param {import('supertest').Response} res
 * @returns {string | undefined}
 */
export const cookieOf = (res) =>
  (res.headers['set-cookie'] ?? []).find((c) => c.startsWith('gc.sid='))?.split(';')[0];

/**
 * Signs in through the real OAuth routes with a mocked GitHub user `ghId` (token `gho_<ghId>`).
 * @param {import('express').Express} app
 * @param {{ exchangeCode: import('vitest').Mock, fetchUser: import('vitest').Mock }} oauth
 * @param {number} ghId
 * @returns {Promise<string>} the session cookie
 */
export async function signIn(app, oauth, ghId) {
  oauth.exchangeCode.mockResolvedValue({ token: `gho_${ghId}`, scopes: '' });
  oauth.fetchUser.mockResolvedValue({ id: ghId, login: `user${ghId}`, avatarUrl: null });
  const start = await request(app).get('/api/auth/github');
  const state = new URL(start.headers.location).searchParams.get('state');
  const cb = await request(app)
    .get(`/api/auth/github/callback?code=abc&state=${state}`)
    .set('Cookie', cookieOf(start));
  return cookieOf(cb);
}
