import { AppError } from '../../errors/AppError.js';

/** AI error codes with their user-facing message (spec 8.9) and audit outcome (spec 5.2). */
export const AI_ERRORS = Object.freeze({
  AI_QUOTA_EXCEEDED: {
    message: 'AI analysis is temporarily unavailable — try again in a moment.',
    outcome: 'quota_exceeded',
  },
  AI_TIMEOUT: {
    message: 'The AI service took too long to respond. Try again.',
    outcome: 'timeout',
  },
  AI_MALFORMED: {
    message: "Couldn't generate a reliable analysis for this file. Try again.",
    outcome: 'malformed_output',
  },
  AI_UNREACHABLE: {
    message: "Couldn't reach the AI service. Check your connection and try again.",
    outcome: 'network_error',
  },
});

/**
 * @param {keyof typeof AI_ERRORS} code
 * @param {number} [attempts] Gemini calls made, kept for the audit row (never sent to the client)
 * @returns {AppError}
 */
export function aiError(code, attempts) {
  const err = new AppError(code, AI_ERRORS[code].message);
  if (attempts !== undefined) err.attempts = attempts;
  return err;
}

/**
 * The audit outcome of a failure: its AI outcome, else `network_error`.
 * @param {unknown} err
 * @returns {'quota_exceeded' | 'timeout' | 'malformed_output' | 'network_error'}
 */
export function auditOutcomeOf(err) {
  return AI_ERRORS[err?.code]?.outcome ?? 'network_error';
}
