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
function rateLimitedError(retryAfterSeconds) {
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

/** A hold older than this is treated as abandoned (an operation that never settled). */
export const STALE_HOLD_MS = 2 * 60 * 1000;

/**
 * One operation in flight per key (spec 7.1: one analysis per user). In-process, which is enough
 * for the single server instance of Demo 1.
 * @param {{ holdMs: number, staleMs?: number }} options `holdMs` is the expected longest run,
 *   used to tell a refused caller when to retry; `staleMs` frees a hold that never settled
 */
export function createInFlightLock({ holdMs, staleMs = STALE_HOLD_MS }) {
  /** @type {Map<string, { startedAt: number }>} */
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
    const now = Date.now();
    const current = held.get(key);
    if (current && now - current.startedAt < staleMs) {
      throw rateLimitedError(Math.max(1, Math.ceil((current.startedAt + holdMs - now) / 1000)));
    }
    // A fresh object per hold, so a stale run that settles late never frees a newer hold.
    const hold = { startedAt: now };
    held.set(key, hold);
    try {
      return await fn();
    } finally {
      if (held.get(key) === hold) held.delete(key);
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
