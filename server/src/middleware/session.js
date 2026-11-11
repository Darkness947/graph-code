import session from 'express-session';
import connectPgSimple from 'connect-pg-simple';

export const SESSION_COOKIE = 'gc.sid';
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Cookie options (spec 7.2). Also used to clear the cookie on logout, which needs the same options.
 * @param {{ NODE_ENV: string }} config
 */
export function cookieOptions(config) {
  return { httpOnly: true, secure: config.NODE_ENV === 'production', sameSite: 'lax' };
}

/**
 * Session middleware backed by the `session` table (created by migration 001).
 * @param {{ NODE_ENV: string, SESSION_SECRET: string }} config
 * @param {import('pg').Pool} pool
 */
export function createSessionMiddleware(config, pool) {
  const PgStore = connectPgSimple(session);
  return session({
    name: SESSION_COOKIE,
    secret: config.SESSION_SECRET,
    store: new PgStore({ pool, tableName: 'session', createTableIfMissing: false }),
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: { ...cookieOptions(config), maxAge: DAY_MS },
  });
}

/**
 * Destroys the session server-side and clears the cookie.
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {{ NODE_ENV: string }} config
 * @returns {Promise<void>}
 */
export function destroySession(req, res, config) {
  return new Promise((resolve, reject) => {
    const done = (err) => {
      res.clearCookie(SESSION_COOKIE, cookieOptions(config));
      return err ? reject(err) : resolve();
    };
    if (!req.session) return done();
    req.session.destroy(done);
  });
}
