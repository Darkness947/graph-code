/**
 * Edge aggregation (spec 8.6 items 2 and 3). Each edge endpoint is replaced by its visible
 * ancestor. Edges whose two ends land on the same node are dropped. Edges between the same
 * pair of visible nodes are merged; a merged edge is "aggregated" (drawn with a count badge)
 * when it stands for more than one import, or when either end is a collapsed folder.
 * Direction stays importer -> imported.
 */

/**
 * @typedef {{ id: string, source: string, target: string, count: number, aggregated: boolean, edgeIds: Array<string | number> }} VisibleEdge
 */

/**
 * @param {Array<{ id: string | number, source: string, target: string }>} edges API edges
 * @param {Map<string, string>} ancestorMap file id -> visible node id
 * @param {Map<string, { type: string }>} nodesById
 * @returns {VisibleEdge[]} in first-seen order
 */
export function aggregateEdges(edges, ancestorMap, nodesById) {
  const merged = new Map();
  for (const edge of edges) {
    const source = ancestorMap.get(edge.source);
    const target = ancestorMap.get(edge.target);
    if (!source || !target || source === target) continue;
    const key = `${source}->${target}`;
    const found = merged.get(key);
    if (found) {
      found.count += 1;
      found.edgeIds.push(edge.id);
    } else {
      merged.set(key, { id: key, source, target, count: 1, aggregated: false, edgeIds: [edge.id] });
    }
  }
  const isFolder = (id) => nodesById.get(id)?.type === 'folder';
  for (const edge of merged.values()) {
    edge.aggregated = edge.count > 1 || isFolder(edge.source) || isFolder(edge.target);
  }
  return [...merged.values()];
}
