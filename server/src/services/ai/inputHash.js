import { createHash } from 'node:crypto';

/** Version of the blast-radius prompt; part of the input hash and stored with each result. */
export const PROMPT_VERSION = 'blast-radius-v1';

/**
 * SHA-256 of a canonical JSON string describing one analysis input (spec 7.7 step 4).
 * The model is deliberately not an input: a result from a fallback model stays a cache hit.
 * @param {{ mode: string,
 *   target: { path: string, contentHash: string | null },
 *   nodes: { path: string, contentHash: string | null, distance: number }[] }} input
 *   `nodes` is the subgraph (target included), in any order
 * @returns {string} lowercase hex digest
 */
export function computeInputHash({ mode, target, nodes }) {
  const sorted = [...nodes]
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    .map((n) => [n.path, n.contentHash ?? null, n.distance]);
  // A fixed key order and array form make the string canonical.
  const canonical = JSON.stringify({
    mode,
    promptVersion: PROMPT_VERSION,
    target: [target.path, target.contentHash ?? null],
    nodes: sorted,
  });
  return createHash('sha256').update(canonical).digest('hex');
}
