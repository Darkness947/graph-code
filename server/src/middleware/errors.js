import { AppError } from '../errors/AppError.js';

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
 * @param {{ NODE_ENV: string }} config
 * @returns {import('express').ErrorRequestHandler}
 */
export function createErrorHandler(config) {
  // Express identifies error handlers by their four parameters.
  return (err, req, res, next) => {
    if (res.headersSent) return next(err);

    let appError;
    if (err instanceof AppError) {
      appError = err;
    } else if (err?.type === 'entity.parse.failed') {
      appError = new AppError('VALIDATION_ERROR', 'The request body is not valid JSON.');
    } else if (err?.type === 'entity.too.large') {
      appError = new AppError('VALIDATION_ERROR', 'The request body is too large.');
    } else {
      appError = new AppError('INTERNAL', 'Something went wrong on our side. Please try again.');
      // Log the cause (not secrets): name, message, and the stack outside production.
      const detail = config.NODE_ENV === 'production' ? err?.message : (err?.stack ?? err?.message);
      console.error(`[${req.id}] unexpected error on ${req.method} ${req.path}: ${detail}`);
    }

    res.status(appError.status).json({
      error: {
        code: appError.code,
        message: appError.message,
        requestId: req.id,
        ...appError.extras,
      },
    });
  };
}
