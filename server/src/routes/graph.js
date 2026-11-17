import { Router } from 'express';
import { uuidParam, validateRequest } from '../middleware/validate.js';

/**
 * Graph and source routes (spec 6.2), mounted under `/repos`. `requireAuth` must already have
 * set `req.user`.
 * @param {{ graph: ReturnType<typeof import('../services/graph/graphQueryService.js').createGraphQueryService> }} deps
 */
export function createGraphRouter({ graph }) {
  const router = Router();

  router.get('/:id/graph', uuidParam('id'), validateRequest, async (req, res) => {
    res.json(await graph.getGraph(req.user.id, req.params.id));
  });

  router.get(
    '/:id/nodes/:nodeId/source',
    uuidParam('id'),
    uuidParam('nodeId'),
    validateRequest,
    async (req, res) => {
      res.json(await graph.getSource(req.user.id, req.params.id, req.params.nodeId));
    },
  );

  return router;
}
