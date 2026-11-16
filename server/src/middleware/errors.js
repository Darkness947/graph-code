import { AppError } from '../errors/AppError.js';
import { destroySession } from './session.js';

/**
 * 404 for any route that did not match (standard error shape).
 * @type {import('express').RequestHandler}
 */
export function notFoundHandler(req, res, next) {
  next(new AppError('NOT_FOUND', 'The requested resource was not found.'));
}

/**
 * Central error handler (spec 7.1). Maps AppError to Part 6.1 and everything else to INTERNAL.
 * The response never contains a stack trace, SQL or an internal path. Details are logged on the
 * server with the request ID.
 *
 * GitHub failures are logged with their reason and status only (never tokens, URLs or headers).
 * When GitHub rejects the signed-in user's token, the stored token is deleted and the session
 * destroyed, so the client's 401 handling sends the user to sign in again.
 * @param {{ NODE_ENV: string }} config
 * @param {{ pool?: import('pg').Pool }} [deps]
 * @returns {import('express').ErrorRequestHandler}
 */
export function createErrorHandler(config, { pool } = {}) {
  // Express identifies error handlers by their four parameters.
  return async (err, req, res, next) => {
    if (res.headersSent) return next(err);

    let appError;
    if (err instanceof AppError) {
      appError = err;
      if (err.githubReason) {
        const status = err.githubStatus === undefined ? '' : ` status=${err.githubStatus}`;
        console.error(
          `[${req.id}] github failure on ${req.method} ${req.path}: reason=${err.githubReason}${status}`,
        );
      }
      if (err.githubReason === 'TOKEN_REJECTED') await forgetRejectedToken(req, res, config, pool);
    } else if (err?.type === 'entity.parse.failed') {
      appError = new AppError('VALIDATION_ERROR', 'The request body is not valid JSON.');
    } else if (err?.type === 'entity.too.large') {
      appError = new AppError('VALIDATION_ERROR', 'The request body is too large.');
    } else if (
      Number.isInteger(err?.status) &&
      err.status >= 400 &&
      err.status < 500 &&
      err.expose === true
    ) {
      // Any other client mistake reported by body-parser (bad charset or encoding, aborted
      // request). Part 6.1 has no 4xx code for these, so they are validation errors.
      appError = new AppError('VALIDATION_ERROR', 'The request could not be read.');
    } else {
      appError = new AppError('INTERNAL', 'Something went wrong on our side. Please try again.');
      // Production logs only the error's name and code: messages from database or HTTP
      // libraries can embed connection strings or URLs. Other environments log the stack.
      const detail =
        config.NODE_ENV === 'production'
          ? `${err?.name ?? 'Error'} ${err?.code ?? ''}`.trim()
          : (err?.stack ?? err?.message);
      console.error(`[${req.id}] unexpected error on ${req.method} ${req.path}: ${detail}`);
    }

    res.status(appError.status).json({
      error: {
        ...appError.extras,
        code: appError.code,
        message: appError.message,
        requestId: req.id,
      },
    });
  };
}

/**
 * Deletes the signed-in user's stored GitHub token and destroys the session. Failures are logged
 * and swallowed: the caller still answers 401.
 */
async function forgetRejectedToken(req, res, config, pool) {
  try {
    if (pool && req.user?.id) {
      await pool.query('UPDATE users SET access_token_enc = NULL WHERE id = $1', [req.user.id]);
    }
    await destroySession(req, res, config);
  } catch (e) {
    console.error(
      `[${req.id}] could not end the session after a rejected token: ${e?.name ?? 'Error'}`,
    );
  }
}
