import { INGESTION_ERROR_CODES } from '../../errors/codes.js';

/**
 * A pipeline failure with an ingestion code from spec 6.1. The orchestrator records the code on
 * the job; the user sees only the matching spec 8.9 message, never `detail`.
 */
export class IngestionError extends Error {
  /**
   * @param {string} code one of INGESTION_ERROR_CODES
   * @param {string} [detail] internal detail, for server logs only
   */
  constructor(code, detail = code) {
    super(detail);
    if (!INGESTION_ERROR_CODES.includes(code)) throw new Error(`Unknown ingestion code: ${code}`);
    this.name = 'IngestionError';
    this.code = code;
  }
}
