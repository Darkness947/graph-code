import { Router } from 'express';
import { body } from 'express-validator';
import { isUuid, uuidParam, validateRequest } from '../middleware/validate.js';

/** Analysis modes available in Demo 1 (spec 7.7). */
const MODES = ['blast_radius'];

/**
 * `POST /api/repos/:id/analyze` (spec 6.2), mounted under `/repos`. `requireAuth` must already
 * have set `req.user`.
 * @param {{ analyze: ReturnType<typeof import('../services/ai/analyzeGraphService.js').createAnalyzeGraphService> }} deps
 */
export function createAnalyzeRouter({ analyze }) {
  const router = Router();

  router.post(
    '/:id/analyze',
    uuidParam('id'),
    body('mode')
      .isIn(MODES)
      .withMessage(`mode must be one of ${MODES.join(', ')}`),
    body('nodeId').custom(isUuid).withMessage('nodeId must be a UUID'),
    validateRequest,
    async (req, res) => {
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
    },
  );

  return router;
}
