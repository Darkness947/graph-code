import { Router } from 'express';
import { query } from 'express-validator';
import { validateRequest } from '../middleware/validate.js';
import { AppError } from '../errors/AppError.js';
import { getUserToken } from '../services/auth/tokenCrypto.js';

const PAGE_SIZE = 30;

/**
 * `GET /api/github/repos` (spec 6.2): the user's public repositories from GitHub.
 * @param {{ pool: import('pg').Pool, crypto: any, github: any,
 *   repos: ReturnType<typeof import('../services/repos/repositoryService.js').createRepositoryService> }} deps
 */
export function createGithubRouter({ pool, crypto, github, repos }) {
  const router = Router();

  router.get(
    '/repos',
    query('page').optional().isInt({ min: 1, max: 10000 }).withMessage('page must be 1 or more'),
    validateRequest,
    async (req, res, next) => {
      try {
        const page = req.query.page ? Number(req.query.page) : 1;
        const token = await getUserToken(pool, crypto, req.user.id);
        if (!token) throw new AppError('UNAUTHENTICATED', 'Please sign in to continue.');
        const [raw, added] = await Promise.all([
          github.listUserRepositories(token, page),
          repos.addedKeys(req.user.id),
        ]);
        const items = raw.map((r) => ({
          owner: r.owner?.login ?? null,
          name: r.name ?? null,
          fullName: r.full_name ?? null,
          description: r.description ?? null,
          language: r.language ?? null,
          defaultBranch: r.default_branch ?? null,
          updatedAt: r.updated_at ?? null,
          alreadyAdded: added.has(`${r.owner?.login}/${r.name}`.toLowerCase()),
        }));
        res.json({ items, nextPage: raw.length >= PAGE_SIZE ? page + 1 : null });
      } catch (err) {
        next(err);
      }
    },
  );

  return router;
}
