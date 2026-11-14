import { Router } from 'express';
import { AppError } from '../errors/AppError.js';
import { createLimiter } from '../middleware/rateLimits.js';
import {
  repoInputBody,
  uuidParam,
  validateRequest,
  parseRepoInput,
} from '../middleware/validate.js';
import { requireUserToken } from '../services/auth/tokenCrypto.js';

/**
 * Repository routes (spec 6.2, 7.5). `requireAuth` must already have set `req.user`.
 * @param {{ pool: import('pg').Pool, crypto: any, github: any, enqueue: (jobId: string) => void,
 *   addRepoLimit: { windowMs: number, limit: number },
 *   repos: ReturnType<typeof import('../services/repos/repositoryService.js').createRepositoryService> }} deps
 */
export function createReposRouter({ pool, crypto, github, enqueue, addRepoLimit, repos }) {
  const router = Router();

  router.get('/', async (req, res) => {
    res.json({ items: await repos.list(req.user.id) });
  });

  router.post(
    '/',
    createLimiter(addRepoLimit),
    repoInputBody(),
    validateRequest,
    async (req, res) => {
      const { owner, name } = parseRepoInput(req.body.repo);
      const token = await requireUserToken(pool, crypto, req.user.id);
      const meta = await github.getRepository(token, owner, name);
      if (meta.private) {
        throw new AppError(
          'REPO_PRIVATE_NOT_SUPPORTED',
          'This repository is private. Only public repositories are supported in this version.',
        );
      }
      const result = await repos.addOrRetry(req.user.id, meta);
      enqueue(result.job.id);
      res.status(202).json(result);
    },
  );

  router.get('/:id', uuidParam('id'), validateRequest, async (req, res) => {
    res.json(await repos.get(req.user.id, req.params.id));
  });

  return router;
}
