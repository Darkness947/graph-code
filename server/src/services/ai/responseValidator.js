import { byPath } from '../../utils/byPath.js';
import { aiError } from './aiErrors.js';

export const MAX_REASON_CHARS = 400;
const LEVEL_RANK = Object.freeze({ high: 0, medium: 1, low: 2 });
// C0 and C1 control characters (tab and newline included: a reason is one line of prose).
// eslint-disable-next-line no-control-regex
const CONTROL_RE = /[\u0000-\u001f\u007f-\u009f]/g;

/**
 * Validates and normalizes a model answer (spec 7.7 step 9).
 * @param {string} text the model's raw JSON text
 * @param {{ targetPath: string, filePaths: Set<string>, distances: Map<string, number> }} ctx
 *   `filePaths` are every file of the repository's graph; `distances` the dependents' distances
 * @returns {{ summary: string, risks: { path: string, level: 'high' | 'medium' | 'low', reason: string }[],
 *   removedCount: number }}
 * @throws {import('../../errors/AppError.js').AppError} AI_MALFORMED
 */
export function validateResponse(text, { targetPath, filePaths, distances }) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw aiError('AI_MALFORMED');
  }
  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.risks)) {
    throw aiError('AI_MALFORMED');
  }

  const risks = [];
  let removedCount = 0;
  for (const risk of parsed.risks) {
    const level = typeof risk?.level === 'string' ? risk.level.trim().toLowerCase() : '';
    const valid =
      risk &&
      typeof risk.path === 'string' &&
      typeof risk.reason === 'string' &&
      Object.hasOwn(LEVEL_RANK, level) &&
      filePaths.has(risk.path) &&
      risk.path !== targetPath;
    if (!valid) {
      removedCount += 1;
      continue;
    }
    risks.push({ path: risk.path, level, reason: cleanText(risk.reason, MAX_REASON_CHARS) });
  }
  // Every risk dropped from a non-empty list means the answer cannot be trusted.
  if (risks.length === 0 && parsed.risks.length > 0) throw aiError('AI_MALFORMED');

  const distanceOf = (p) => distances.get(p) ?? Number.MAX_SAFE_INTEGER;
  risks.sort(
    (a, b) =>
      LEVEL_RANK[a.level] - LEVEL_RANK[b.level] ||
      distanceOf(a.path) - distanceOf(b.path) ||
      byPath(a, b),
  );

  const summary = typeof parsed.summary === 'string' ? cleanText(parsed.summary) : '';
  return { summary, risks, removedCount };
}

/**
 * @param {string} text
 * @param {number} [max]
 */
function cleanText(text, max = Infinity) {
  return text.replace(CONTROL_RE, ' ').trim().slice(0, max);
}
