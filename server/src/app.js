import express from 'express';
import { applySecurity } from './middleware/security.js';
import {
  createLimiter,
  createInFlightLock,
  GLOBAL_LIMIT,
  ADD_REPO_LIMIT,
  ANALYZE_LIMIT,
} from './middleware/rateLimits.js';
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
import { createJobRepository } from './services/ingestion/jobRepository.js';
import { createJobsRouter } from './routes/jobs.js';
import { createGraphRouter } from './routes/graph.js';
import { createGraphRepository } from './services/graph/graphRepository.js';
import { createGraphQueryService } from './services/graph/graphQueryService.js';
import { requireUserToken } from './services/auth/tokenCrypto.js';
import { createAnalyzeRouter } from './routes/analyze.js';
import { createAnalyzeGraphService } from './services/ai/analyzeGraphService.js';
import { createAiCacheRepository } from './services/ai/aiCacheRepository.js';
import { createAuditLogger } from './services/ai/auditLogger.js';
import { createCodeRetriever } from './services/ai/codeRetriever.js';
import { createGeminiClient } from './services/ai/geminiClient.js';

/**
 * Builds the Express app (exported for Supertest). Routes are added by later tasks.
 * Without a `pool` only the health route is served (no sessions).
 * @param {Record<string, any>} config validated configuration from loadConfig
 * @param {{ globalLimit?: { windowMs: number, limit: number }, pool?: import('pg').Pool,
 *   oauth?: ReturnType<typeof createGithubOAuth>,
 *   crypto?: ReturnType<typeof tokenCryptoFromConfig>, github?: ReturnType<typeof createGithubClient>,
 *   enqueue?: (jobId: string) => void, addRepoLimit?: { windowMs: number, limit: number },
 *   analyzeLimit?: { windowMs: number, limit: number },
 *   gemini?: ReturnType<typeof createGeminiClient> }} [options] pool and test overrides
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
    const jobs = createJobRepository(pool);
    // index.js passes the real queue; tests that omit it leave jobs queued.
    const enqueue = options.enqueue ?? (() => {});
    const addRepoLimit = options.addRepoLimit ?? ADD_REPO_LIMIT;
    api.use('/github', requireAuth, createGithubRouter({ pool, crypto, github, repos }));
    const graphs = createGraphRepository(pool);
    const getToken = (userId) => requireUserToken(pool, crypto, userId);
    const graph = createGraphQueryService({ repos, graphs, github, getToken });
    const analyze = createAnalyzeGraphService({
      repos,
      graphs,
      cache: createAiCacheRepository(pool),
      audit: createAuditLogger(pool),
      retriever: createCodeRetriever(github),
      gemini:
        options.gemini ??
        createGeminiClient({
          apiKey: config.GEMINI_API_KEY,
          models: config.GEMINI_MODELS,
          timeoutMs: config.AI_TIMEOUT_MS,
          attemptTimeoutMs: config.AI_ATTEMPT_TIMEOUT_MS,
        }),
      getToken,
    });
    api.use(
      '/repos',
      requireAuth,
      createGraphRouter({ graph }),
      createAnalyzeRouter({
        analyze,
        analyzeLimit: options.analyzeLimit ?? ANALYZE_LIMIT,
        lock: createInFlightLock({ holdMs: config.AI_TIMEOUT_MS }),
      }),
      createReposRouter({ pool, crypto, github, enqueue, addRepoLimit, repos }),
    );
    api.use('/jobs', requireAuth, createJobsRouter({ jobs }));
  }
  app.use('/api', api);

  app.use(notFoundHandler);
  app.use(createErrorHandler(config, { pool }));
  return app;
}
