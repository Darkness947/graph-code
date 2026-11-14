import express from 'express';
import { applySecurity } from './middleware/security.js';
import { createLimiter, GLOBAL_LIMIT, ADD_REPO_LIMIT } from './middleware/rateLimits.js';
import { notFoundHandler, createErrorHandler } from './middleware/errors.js';
import { createSessionMiddleware } from './middleware/session.js';
import { createRequireAuth } from './middleware/requireAuth.js';
import { createGithubOAuth } from './services/auth/githubOAuth.js';
import { tokenCryptoFromConfig } from './services/auth/tokenCrypto.js';
import healthRouter from './routes/health.js';
import { createAuthRouter } from './routes/auth.js';
import { createMeRouter } from './routes/me.js';
import { createGithubRouter } from './routes/github.js';
import { createReposRouter } from './routes/repos.js';
import { createGithubClient } from './services/github/githubClient.js';
import { createRepositoryService } from './services/repos/repositoryService.js';

/**
 * Builds the Express app (exported for Supertest). Routes are added by later tasks.
 * Without a `pool` only the health route is served (no sessions).
 * @param {Record<string, any>} config validated configuration from loadConfig
 * @param {{ globalLimit?: { windowMs: number, limit: number }, pool?: import('pg').Pool,
 *   oauth?: ReturnType<typeof createGithubOAuth>,
 *   crypto?: ReturnType<typeof tokenCryptoFromConfig>, github?: ReturnType<typeof createGithubClient>,
 *   enqueue?: (jobId: string) => void, addRepoLimit?: { windowMs: number, limit: number } }} [options] pool and test overrides
 * @returns {import('express').Express}
 */
export function createApp(config, options = {}) {
  const app = express();
  applySecurity(app, config);

  const api = express.Router();
  const { pool } = options;
  // The session comes first so the rate limiter can key by user ID.
  if (pool) api.use(createSessionMiddleware(config, pool));
  api.use(createLimiter(options.globalLimit ?? GLOBAL_LIMIT));
  api.use(healthRouter);

  if (pool) {
    const oauth = options.oauth ?? createGithubOAuth(config);
    const crypto = options.crypto ?? tokenCryptoFromConfig(config);
    const requireAuth = createRequireAuth(pool, config);
    api.use(createAuthRouter({ config, pool, oauth, crypto }));
    api.use('/me', requireAuth, createMeRouter({ pool }));

    const github = options.github ?? createGithubClient({ maxZipBytes: config.MAX_ZIP_BYTES });
    const repos = createRepositoryService(pool);
    // The queue arrives in T2.2; until then jobs stay queued.
    const enqueue = options.enqueue ?? (() => {});
    const addRepoLimit = options.addRepoLimit ?? ADD_REPO_LIMIT;
    api.use('/github', requireAuth, createGithubRouter({ pool, crypto, github, repos }));
    api.use(
      '/repos',
      requireAuth,
      createReposRouter({ pool, crypto, github, enqueue, addRepoLimit, repos }),
    );
  }
  app.use('/api', api);

  app.use(notFoundHandler);
  app.use(createErrorHandler(config));
  return app;
}
