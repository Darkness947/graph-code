import { Router } from 'express';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { destroySession } from '../middleware/session.js';

/** Constant-time comparison; false when either value is missing or the lengths differ. */
export function statesMatch(expected, received) {
  if (typeof expected !== 'string' || typeof received !== 'string') return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(received);
  return a.length === b.length && timingSafeEqual(a, b);
}

const promisify = (fn) =>
  new Promise((resolve, reject) => fn((err) => (err ? reject(err) : resolve())));

/**
 * Sign-in and logout routes (spec 7.2).
 * @param {{ config: object, pool: import('pg').Pool, oauth: object, crypto: object }} deps
 */
export function createAuthRouter({ config, pool, oauth, crypto }) {
  const router = Router();

  const fail = async (req, res, code) => {
    await destroySession(req, res, config);
    res.redirect(`/error?code=${code}`);
  };

  router.get('/auth/github', async (req, res) => {
    const state = randomBytes(32).toString('hex');
    req.session.oauthState = state;
    await promisify((cb) => req.session.save(cb));
    res.redirect(oauth.authorizeUrl(state));
  });

  router.get('/auth/github/callback', async (req, res) => {
    const { code, state, error } = req.query;
    if (error === 'access_denied') return fail(req, res, 'access_denied');

    const expected = req.session?.oauthState;
    if (!statesMatch(expected, state)) return fail(req, res, 'state_mismatch');
    delete req.session.oauthState;

    let ghUser;
    let grant;
    try {
      if (typeof code !== 'string' || code === '') throw new Error('missing code');
      grant = await oauth.exchangeCode(code);
      ghUser = await oauth.fetchUser(grant.token);
    } catch {
      return fail(req, res, 'oauth_failed');
    }

    const { enc, keyId } = crypto.encrypt(grant.token);
    const { rows } = await pool.query(
      `INSERT INTO users (github_id, github_login, avatar_url, granted_scopes,
                          access_token_enc, token_key_id, last_login_at)
       VALUES ($1, $2, $3, $4, $5, $6, now())
       ON CONFLICT (github_id) DO UPDATE SET
         github_login = EXCLUDED.github_login,
         avatar_url = EXCLUDED.avatar_url,
         granted_scopes = EXCLUDED.granted_scopes,
         access_token_enc = EXCLUDED.access_token_enc,
         token_key_id = EXCLUDED.token_key_id,
         last_login_at = now()
       RETURNING id`,
      [ghUser.id, ghUser.login, ghUser.avatarUrl, grant.scopes, enc, keyId],
    );

    await promisify((cb) => req.session.regenerate(cb));
    req.session.userId = rows[0].id;
    await promisify((cb) => req.session.save(cb));
    res.redirect('/dashboard');
  });

  router.post('/auth/logout', async (req, res) => {
    await destroySession(req, res, config);
    res.status(204).end();
  });

  return router;
}
