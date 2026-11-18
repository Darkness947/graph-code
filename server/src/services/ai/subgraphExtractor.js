import { byPath } from '../../utils/byPath.js';

/** Most dependents sent to the model with the target (spec 7.7 step 3). */
export const MAX_SUBGRAPH_DEPENDENTS = 40;

/**
 * Picks the nearest dependents for the prompt: by distance, then path; at most `limit`.
 * @template {{ path: string, distance: number }} T
 * @param {T[]} dependents
 * @param {number} [limit]
 * @returns {T[]}
 */
export function nearestDependents(dependents, limit = MAX_SUBGRAPH_DEPENDENTS) {
  return [...dependents].sort((a, b) => a.distance - b.distance || byPath(a, b)).slice(0, limit);
}

/**
 * The target as a subgraph node, at distance 0.
 * @param {{ path: string, contentHash: string | null }} target
 * @returns {{ path: string, contentHash: string | null, distance: number }}
 */
export const targetNode = (target) => ({
  path: target.path,
  contentHash: target.contentHash,
  distance: 0,
});

/**
 * Builds the analysis subgraph: the target plus up to 40 nearest dependents, with the import
 * edges among them (spec 7.7 step 3).
 * @param {{ edgesAmong: (userId: string, repoId: string, nodeIds: string[]) =>
 *   Promise<{ source: string, target: string }[]> }} graphs
 */
export function createSubgraphExtractor(graphs) {
  /**
   * @param {string} userId
   * @param {string} repoId
   * @param {{ id: string, path: string, contentHash: string | null }} target
   * @param {{ nodeId: string, path: string, contentHash: string | null, sizeBytes: number | null,
   *   distance: number }[]} dependents every dependent
   * @returns {Promise<{ selected: typeof dependents, nodes: ReturnType<typeof targetNode>[],
   *   edges: { source: string, target: string }[] }>} `selected` are the nearest 40, `nodes` the
   *   target plus those
   */
  async function extract(userId, repoId, target, dependents) {
    const selected = nearestDependents(dependents);
    const nodeIds = [target.id, ...selected.map((d) => d.nodeId)];
    const edges = await graphs.edgesAmong(userId, repoId, nodeIds);
    const nodes = [
      targetNode(target),
      ...selected.map((d) => ({ path: d.path, contentHash: d.contentHash, distance: d.distance })),
    ];
    return { selected, nodes, edges };
  }

  return { extract };
}
