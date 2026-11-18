import { MAX_SOURCE_BYTES } from '../github/githubClient.js';

/** Excerpt limits (spec 7.7 step 6). */
export const EXCERPT_LIMITS = Object.freeze({
  targetChars: 12000,
  dependentChars: 3000,
  dependentCount: 10,
  totalChars: 40000,
  concurrency: 4,
});

/**
 * Runs `task` over `items` with at most `limit` in flight, keeping the input order in the result.
 * @template T, R
 * @param {T[]} items
 * @param {number} limit
 * @param {(item: T) => Promise<R>} task
 * @returns {Promise<R[]>}
 */
export async function mapWithConcurrency(items, limit, task) {
  const results = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await task(items[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/**
 * Fetches code excerpts from GitHub at the analyzed commit (spec 7.7 step 6). Excerpts are held
 * in memory only. A file that is too large or cannot be fetched is left out; the analysis still
 * has the graph structure.
 * @param {{ getFileSource: (token: string, owner: string, name: string, path: string, sha: string) => Promise<string> }} github
 * @param {typeof EXCERPT_LIMITS} [limits]
 */
export function createCodeRetriever(github, limits = EXCERPT_LIMITS) {
  /**
   * @param {{ token: string, owner: string, name: string, commitSha: string,
   *   target: { path: string, sizeBytes: number | null },
   *   dependents: { path: string, sizeBytes: number | null }[] }} input dependents nearest first
   * @returns {Promise<{ path: string, text: string }[]>} target first, then dependents
   */
  async function retrieve({ token, owner, name, commitSha, target, dependents }) {
    const wanted = [
      { ...target, cap: limits.targetChars },
      ...dependents
        .slice(0, limits.dependentCount)
        .map((d) => ({ ...d, cap: limits.dependentChars })),
    ];
    const texts = await mapWithConcurrency(wanted, limits.concurrency, async (file) => {
      if (file.sizeBytes > MAX_SOURCE_BYTES) return null;
      try {
        const source = await github.getFileSource(token, owner, name, file.path, commitSha);
        return source.slice(0, file.cap);
      } catch {
        return null;
      }
    });

    const excerpts = [];
    let budget = limits.totalChars;
    wanted.forEach((file, i) => {
      if (texts[i] === null || budget <= 0) return;
      const text = texts[i].slice(0, budget);
      budget -= text.length;
      excerpts.push({ path: file.path, text });
    });
    return excerpts;
  }

  return { retrieve };
}
