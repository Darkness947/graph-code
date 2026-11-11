import { AppError } from '../errors/AppError.js';
import { destroySession } from './session.js';

/**
 * Loads the signed-in user (`req.user`). With no session or no such user, the session is
 * destroyed and the request gets 401 UNAUTHENTICATED (spec 7.2).
 * @param {import('pg').Pool} pool
 * @param {{ NODE_ENV: string }} config
 * @returns {import('express').RequestHandler}
 */
export function createRequireAuth(pool, config) {
  return async (req, res, next) => {
    try {
      const userId = req.session?.userId;
      if (userId) {
        const { rows } = await pool.query(
          'SELECT id, github_login, avatar_url, ai_notice_ack_at FROM users WHERE id = $1',
          [userId],
        );
        if (rows.length > 0) {
          req.user = rows[0];
          return next();
        }
      }
      await destroySession(req, res, config);
      next(new AppError('UNAUTHENTICATED', 'Please sign in to continue.'));
    } catch (err) {
      next(err);
    }
  };
}
