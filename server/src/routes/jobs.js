import { Router } from 'express';
import { uuidParam, validateRequest } from '../middleware/validate.js';

/**
 * Job routes (spec 6.2). `requireAuth` must already have set `req.user`.
 * @param {{ jobs: ReturnType<typeof import('../services/ingestion/jobRepository.js').createJobRepository> }} deps
 */
export function createJobsRouter({ jobs }) {
  const router = Router();

  router.get('/:jobId', uuidParam('jobId'), validateRequest, async (req, res) => {
    res.json(await jobs.getForUser(req.user.id, req.params.jobId));
  });

  return router;
}
