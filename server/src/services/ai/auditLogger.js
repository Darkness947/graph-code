import { createHash } from 'node:crypto';

/**
 * @param {string | null | undefined} sessionId
 * @returns {string | null} SHA-256 hex of the session ID; the raw ID is never stored
 */
export function hashSessionId(sessionId) {
  return sessionId ? createHash('sha256').update(sessionId).digest('hex') : null;
}

/**
 * Writes `ai_audit_log` rows (spec 7.7 step 10). Only for repositories the user owns.
 * A failed audit write is logged (without data) and never fails the analysis.
 * @param {import('pg').Pool} pool
 * @param {(line: string) => void} [logError]
 */
export function createAuditLogger(pool, logError = (line) => console.error(line)) {
  /**
   * @param {{ userId: string, repositoryId: string, sessionId?: string | null, requestId?: string,
   *   aiResultId?: string | null, mode: string, targetPath: string, inputHash: string,
   *   cacheHit: boolean, model?: string | null, attempts: number,
   *   outcome: 'success' | 'quota_exceeded' | 'timeout' | 'malformed_output' | 'network_error',
   *   latencyMs: number }} entry
   * @returns {Promise<void>}
   */
  async function record(entry) {
    try {
      await pool.query(
        `INSERT INTO ai_audit_log (repository_id, ai_result_id, session_id_hash, mode, target_path,
           input_hash, cache_hit, model, attempts, outcome, latency_ms)
         SELECT r.id, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12
         FROM repositories r WHERE r.id = $1 AND r.user_id = $2`,
        [
          entry.repositoryId,
          entry.userId,
          entry.aiResultId ?? null,
          hashSessionId(entry.sessionId),
          entry.mode,
          entry.targetPath,
          entry.inputHash,
          entry.cacheHit,
          entry.model ?? null,
          entry.attempts,
          entry.outcome,
          Math.round(entry.latencyMs),
        ],
      );
    } catch (err) {
      logError(`[${entry.requestId ?? '-'}] ai audit write failed: ${err?.code ?? err?.name}`);
    }
  }

  return { record };
}
