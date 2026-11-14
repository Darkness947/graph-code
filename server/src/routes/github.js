import { Router } from 'express';
import { query } from 'express-validator';
import { validateRequest } from '../middleware/validate.js';
import { requireUserToken } from '../services/auth/tokenCrypto.js';
import { repoKey } from '../services/repos/repositoryService.js';

const PAGE_SIZE = 30;
const MAX_PAGE = 10000;

/**
 * `GET /api/github/repos` (spec 6.2): the user's public repositories from GitHub.
 * Express 5 forwards rejected async handlers to the error handler.
 * @param {{ pool: import('pg').Pool, crypto: any, github: any,
 *   repos: ReturnType<typeof import('../services/repos/repositoryService.js').createRepositoryService> }} deps
 */
export function createGithubRouter({ pool, crypto, github, repos }) {
  const router = Router();

  router.get(
    '/repos',
    query('page')
      .optional()
      .isInt({ min: 1, max: MAX_PAGE })
      .withMessage(`page must be a whole number from 1 to ${MAX_PAGE}`),
    validateRequest,
    async (req, res) => {
      const page = req.query.page ? Number(req.query.page) : 1;
      const token = await requireUserToken(pool, crypto, req.user.id);
      const [raw, added] = await Promise.all([
        github.listUserRepositories(token, page),
        repos.addedKeys(req.user.id),
      ]);
      const items = raw.map((r) => ({
        owner: r.owner?.login ?? null,
        name: r.name,
        fullName: r.full_name,
        description: r.description ?? null,
        language: r.language ?? null,
        defaultBranch: r.default_branch ?? null,
        updatedAt: r.updated_at ?? null,
        alreadyAdded: added.has(repoKey(r.owner?.login, r.name)),
      }));
      // No next page past the cap: the validator would reject it.
      const hasMore = raw.length >= PAGE_SIZE && page < MAX_PAGE;
      res.json({ items, nextPage: hasMore ? page + 1 : null });
    },
  );

  return router;
}
