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
   *   distance: number }[]} dependents
   */
  async function extract(userId, repoId, target, dependents) {
    const selected = nearestDependents(dependents);
    const nodeIds = [target.id, ...selected.map((d) => d.nodeId)];
    const edges = await graphs.edgesAmong(userId, repoId, nodeIds);
    const nodes = [
      { path: target.path, contentHash: target.contentHash, distance: 0 },
      ...selected.map((d) => ({ path: d.path, contentHash: d.contentHash, distance: d.distance })),
    ];
    return { dependents: selected, nodes, edges };
  }

  return { extract };
}
