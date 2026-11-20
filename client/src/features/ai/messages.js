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
 * Each analysis error's wording (spec 8.9) and its calm icon (spec 8.6): a clock for waiting
 * (quota, timeout, our own rate limit), a plug for a service that couldn't be reached, a warning
 * for anything else. `RATE_LIMITED` and `GITHUB_UNAVAILABLE` share the dashboard's wording.
 */
const AI_ERRORS = {
  AI_QUOTA_EXCEEDED: {
    icon: 'bi-clock',
    message: () => 'AI analysis is temporarily unavailable — try again in a moment.',
  },
  AI_TIMEOUT: {
    icon: 'bi-clock',
    message: () => 'The AI service took too long to respond. Try again.',
  },
  AI_UNREACHABLE: {
    icon: 'bi-plug',
    message: () => "Couldn't reach the AI service. Check your connection and try again.",
  },
  AI_MALFORMED: {
    icon: 'bi-exclamation-triangle',
    message: () => "Couldn't generate a reliable analysis for this file. Try again.",
  },
  RATE_LIMITED: {
    icon: 'bi-clock',
    message: (retryAfterSeconds) => addErrorMessage({ code: 'RATE_LIMITED', retryAfterSeconds }),
  },
  GITHUB_UNAVAILABLE: {
    icon: 'bi-plug',
    message: () => addErrorMessage({ code: 'GITHUB_UNAVAILABLE' }),
  },
};
const OTHER_ERROR = { icon: 'bi-exclamation-triangle', message: () => GENERIC_ERROR };

/**
 * The message for a failed analysis (spec 8.9).
 * @param {string | null} code
 * @param {number | undefined} [retryAfterSeconds] for `RATE_LIMITED`
 */
export const aiErrorMessage = (code, retryAfterSeconds) =>
  (Object.hasOwn(AI_ERRORS, code) ? AI_ERRORS[code] : OTHER_ERROR).message(retryAfterSeconds);

/** @param {string | null} code */
export const aiErrorIcon = (code) =>
  (Object.hasOwn(AI_ERRORS, code) ? AI_ERRORS[code] : OTHER_ERROR).icon;
