import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { AppError } from '../errors/AppError.js';

/**
 * Key for rate limiting: the signed-in user's ID when there is one, otherwise the client IP.
 * (`req.session.userId` is set from T1.4 on.)
 * @param {import('express').Request} req
 * @returns {string}
 */
export function rateLimitKey(req) {
  const userId = req.session?.userId;
  return userId ? `user:${userId}` : `ip:${ipKeyGenerator(req.ip ?? '')}`;
}

/**
 * Builds a limiter that answers with the standard RATE_LIMITED error (spec 6.1).
 * @param {{ windowMs: number, limit: number }} options
 * @returns {import('express').RequestHandler}
 */
export function createLimiter({ windowMs, limit }) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator: rateLimitKey,
    handler: (req, res, next) => {
      const resetTime = req.rateLimit?.resetTime;
      const retryAfterSeconds = resetTime
        ? Math.max(1, Math.ceil((resetTime.getTime() - Date.now()) / 1000))
        : Math.ceil(windowMs / 1000);
      next(
        new AppError(
          'RATE_LIMITED',
          `You're doing that too often. Try again in ${retryAfterSeconds} seconds.`,
          {
            retryAfterSeconds,
          },
        ),
      );
    },
  });
}

/** All `/api` routes: 300 requests per 15 minutes (spec 7.1). */
export const GLOBAL_LIMIT = { windowMs: 15 * 60 * 1000, limit: 300 };

/** `POST /api/repos`: 5 requests per 10 minutes (spec 7.1). */
export const ADD_REPO_LIMIT = { windowMs: 10 * 60 * 1000, limit: 5 };
