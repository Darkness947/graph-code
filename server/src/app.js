import express from 'express';
import { applySecurity } from './middleware/security.js';
import { createLimiter, GLOBAL_LIMIT } from './middleware/rateLimits.js';
import { notFoundHandler, createErrorHandler } from './middleware/errors.js';
import healthRouter from './routes/health.js';

/**
 * Builds the Express app (exported for Supertest). Routes are added by later tasks.
 * @param {Record<string, any>} config validated configuration from loadConfig
 * @param {{ globalLimit?: { windowMs: number, limit: number } }} [options] test overrides
 * @returns {import('express').Express}
 */
export function createApp(config, options = {}) {
  const app = express();
  applySecurity(app, config);

  const api = express.Router();
  api.use(createLimiter(options.globalLimit ?? GLOBAL_LIMIT));
  api.use(healthRouter);
  app.use('/api', api);

  app.use(notFoundHandler);
  app.use(createErrorHandler(config));
  return app;
}
