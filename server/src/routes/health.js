import { Router } from 'express';

const router = Router();

/** Liveness only. Checks nothing external, so it stays cheap for UptimeRobot (spec 6.2). */
router.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

export default router;
