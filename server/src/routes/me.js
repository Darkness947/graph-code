import { Router } from 'express';

/**
 * Current-user routes (spec 6.2). `requireAuth` must already have set `req.user`.
 * @param {{ pool: import('pg').Pool }} deps
 */
export function createMeRouter({ pool }) {
  const router = Router();

  router.get('/', (req, res) => {
    const u = req.user;
    res.json({
      id: u.id,
      login: u.github_login,
      avatarUrl: u.avatar_url,
      aiNoticeAcknowledged: u.ai_notice_ack_at !== null,
    });
  });

  router.post('/ai-notice', async (req, res) => {
    await pool.query(
      'UPDATE users SET ai_notice_ack_at = COALESCE(ai_notice_ack_at, now()) WHERE id = $1',
      [req.user.id],
    );
    res.status(204).end();
  });

  return router;
}
