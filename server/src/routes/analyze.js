import { Router } from 'express';
import { body } from 'express-validator';
import { isUuid, uuidParam, validateRequest } from '../middleware/validate.js';
import { createLimiter, rateLimitedError } from '../middleware/rateLimits.js';

/** Analysis modes available in Demo 1 (spec 7.7). */
const MODES = ['blast_radius'];

/**
 * `POST /api/repos/:id/analyze` (spec 6.2), mounted under `/repos`. `requireAuth` must already
 * have set `req.user`. Rate limited (spec 7.1), with one analysis in flight per user.
 * @param {{ analyze: ReturnType<typeof import('../services/ai/analyzeGraphService.js').createAnalyzeGraphService>,
 *   analyzeLimit: { windowMs: number, limit: number },
 *   lock: ReturnType<typeof import('../middleware/rateLimits.js').createInFlightLock> }} deps
 */
export function createAnalyzeRouter({ analyze, analyzeLimit, lock }) {
  const router = Router();

  router.post(
    '/:id/analyze',
    createLimiter(analyzeLimit),
    uuidParam('id'),
    body('mode')
      .isIn(MODES)
      .withMessage(`mode must be one of ${MODES.join(', ')}`),
    body('nodeId').custom(isUuid).withMessage('nodeId must be a UUID'),
    validateRequest,
    async (req, res) => {
      const slot = lock.tryAcquire(req.user.id);
      if (!('release' in slot)) throw rateLimitedError(slot.retryAfterSeconds);
      // Released when the analysis settles, not when the client disconnects.
      try {
        res.json(
          await analyze.analyzeGraph({
            userId: req.user.id,
            sessionId: req.sessionID,
            requestId: req.id,
            repositoryId: req.params.id,
            mode: req.body.mode,
            nodeId: req.body.nodeId,
          }),
        );
      } finally {
        slot.release();
      }
    },
  );

  return router;
}
