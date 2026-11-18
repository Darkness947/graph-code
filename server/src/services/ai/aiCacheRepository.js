/**
 * AI result cache (`ai_results`, spec 7.7 steps 5 and 10). Every query is scoped to the
 * signed-in user's repository. Parameterized SQL only.
 * @param {import('pg').Pool} pool
 */
export function createAiCacheRepository(pool) {
  /**
   * @param {{ userId: string, repositoryId: string, mode: string, targetPath: string, inputHash: string }} key
   * @returns {Promise<{ id: string, response: Record<string, any>, createdAt: Date } | null>}
   */
  async function find({ userId, repositoryId, mode, targetPath, inputHash }) {
    const { rows } = await pool.query(
      `SELECT a.id, a.response, a.created_at AS "createdAt"
       FROM ai_results a
       JOIN repositories r ON r.id = $1 AND r.user_id = $2
       WHERE a.repository_id = r.id AND a.mode = $3 AND a.target_path = $4 AND a.input_hash = $5`,
      [repositoryId, userId, mode, targetPath, inputHash],
    );
    return rows[0] ?? null;
  }

  /**
   * Stores a result; a concurrent identical insert keeps the first row (ON CONFLICT DO NOTHING).
   * @param {{ userId: string, repositoryId: string, mode: string, targetPath: string,
   *   inputHash: string, model: string, promptVersion: string, response: Record<string, any> }} row
   * @returns {Promise<string | null>} the stored row's id
   */
  async function save({
    userId,
    repositoryId,
    mode,
    targetPath,
    inputHash,
    model,
    promptVersion,
    response,
  }) {
    const inserted = await pool.query(
      `INSERT INTO ai_results (repository_id, target_path, mode, input_hash, model, prompt_version, response)
       SELECT r.id, $3, $4, $5, $6, $7, $8::jsonb
       FROM repositories r WHERE r.id = $1 AND r.user_id = $2
       ON CONFLICT DO NOTHING
       RETURNING id`,
      [repositoryId, userId, targetPath, mode, inputHash, model, promptVersion, response],
    );
    if (inserted.rows[0]) return inserted.rows[0].id;
    return (await find({ userId, repositoryId, mode, targetPath, inputHash }))?.id ?? null;
  }

  return { find, save };
}
