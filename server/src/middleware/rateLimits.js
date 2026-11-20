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
 * The standard RATE_LIMITED error (spec 6.1, wording from 8.9).
 * @param {number} retryAfterSeconds
 * @returns {AppError}
 */
export function rateLimitedError(retryAfterSeconds) {
  return new AppError(
    'RATE_LIMITED',
    `You're doing that too often. Try again in ${retryAfterSeconds} seconds.`,
    { retryAfterSeconds },
  );
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
      next(rateLimitedError(retryAfterSeconds));
    },
  });
}

/**
 * One operation in flight per key (spec 7.1: one analysis per user). In-process, which is enough
 * for the single server instance of Demo 1.
 * @param {{ holdMs: number }} options how long one operation can take at most; tells a refused
 *   caller when to retry
 */
export function createInFlightLock({ holdMs }) {
  /** @type {Map<string, number>} key -> start time (ms) */
  const held = new Map();

  /**
   * Runs `fn` while holding `key`. Throws RATE_LIMITED while another call holds it. The key is
   * released when `fn` settles, not when the client disconnects.
   * @template T
   * @param {string} key
   * @param {() => Promise<T>} fn
   * @returns {Promise<T>}
   */
  async function run(key, fn) {
    const startedAt = held.get(key);
    if (startedAt !== undefined) {
      throw rateLimitedError(Math.max(1, Math.ceil((startedAt + holdMs - Date.now()) / 1000)));
    }
    held.set(key, Date.now());
    try {
      return await fn();
    } finally {
      held.delete(key);
    }
  }

  return { run };
}

/** All `/api` routes: 300 requests per 15 minutes (spec 7.1). */
export const GLOBAL_LIMIT = { windowMs: 15 * 60 * 1000, limit: 300 };

/** `POST /api/repos`: 5 requests per 10 minutes (spec 7.1). */
export const ADD_REPO_LIMIT = { windowMs: 10 * 60 * 1000, limit: 5 };

/** `POST /api/repos/:id/analyze`: 10 requests per minute (spec 7.1). */
export const ANALYZE_LIMIT = { windowMs: 60 * 1000, limit: 10 };
