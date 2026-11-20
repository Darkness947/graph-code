/** Wording for the AI panel (spec 8.6 and 8.9). Use exactly; do not paraphrase. */
import { addErrorMessage, GENERIC_ERROR } from '../repos/messages.js';

export const ANALYZE = 'Analyze change impact (AI)';
export const ANALYZING = 'Analyzing…';
export const NO_DEPENDENTS = 'No files depend on this file. It appears safe to modify on its own.';
export const DISCLAIMER =
  'AI predictions are based on static analysis and may be incomplete. Use them as guidance, not a guarantee.';
export const REMOVED_NOTE = (n) =>
  `${n} suggested file(s) were removed because they don't exist in this repository.`;
export const MORE_FILES = (n) => `+${n} more files`;

export const NOTICE_TITLE = 'Before your first AI analysis';
export const NOTICE_TEXT =
  "To predict change impact, Graph Code sends excerpts of the selected file and the files that depend on it to Google's Gemini API. On the free tier, Google may use submitted content to improve its products. Graph Code does not store your source code.";
export const NOTICE_CONFIRM = 'I understand, analyze';

/**
 * The message for a failed analysis (spec 8.9).
 * @param {string | null} code
 * @param {number | undefined} [retryAfterSeconds] for `RATE_LIMITED`
 */
export function aiErrorMessage(code, retryAfterSeconds) {
  switch (code) {
    case 'AI_QUOTA_EXCEEDED':
      return 'AI analysis is temporarily unavailable — try again in a moment.';
    case 'AI_TIMEOUT':
      return 'The AI service took too long to respond. Try again.';
    case 'AI_UNREACHABLE':
      return "Couldn't reach the AI service. Check your connection and try again.";
    case 'AI_MALFORMED':
      return "Couldn't generate a reliable analysis for this file. Try again.";
    case 'RATE_LIMITED':
    case 'GITHUB_UNAVAILABLE':
      return addErrorMessage({ code, retryAfterSeconds });
    default:
      return GENERIC_ERROR;
  }
}

/**
 * A calm icon per failure (spec 8.6): a clock for waiting (quota, timeout, our own rate limit),
 * a plug for a service that couldn't be reached, a warning for anything else.
 * @param {string | null} code
 */
export function aiErrorIcon(code) {
  switch (code) {
    case 'AI_QUOTA_EXCEEDED':
    case 'AI_TIMEOUT':
    case 'RATE_LIMITED':
      return 'bi-clock';
    case 'AI_UNREACHABLE':
    case 'GITHUB_UNAVAILABLE':
      return 'bi-plug';
    default:
      return 'bi-exclamation-triangle';
  }
}
