import { ERROR_STATUS } from './codes.js';

/**
 * An error with a Part 6.1 code. `message` must be user-safe: no stack traces, SQL or
 * internal paths. `extras` are merged into the response body's `error` object
 * (for example `details`, `repositoryId`, `jobId`, `retryAfterSeconds`).
 */
export class AppError extends Error {
  /**
   * @param {keyof typeof ERROR_STATUS} code
   * @param {string} message user-safe message
   * @param {Record<string, unknown>} [extras]
   */
  constructor(code, message, extras = {}) {
    super(message);
    if (!(code in ERROR_STATUS)) throw new Error(`Unknown error code: ${code}`);
    this.name = 'AppError';
    this.code = code;
    this.status = ERROR_STATUS[code];
    this.extras = extras;
  }
}
