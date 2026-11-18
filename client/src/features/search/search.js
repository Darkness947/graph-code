/** Filename search (spec 8.6): a case-insensitive substring match on the file path. */

export const MAX_RESULTS = 20;

/**
 * @param {{ nodesById: Map<string, any> }} index
 * @param {string} query
 * @param {number} [limit]
 * @returns {Array<{ id: string, path: string, start: number, end: number }>} `start`..`end` is the
 *   matched part of `path`. Matches in the file name come first, then shorter paths, then
 *   alphabetical order. An empty query matches nothing.
 */
export function searchFiles(index, query, limit = MAX_RESULTS) {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  const hits = [];
  for (const node of index.nodesById.values()) {
    if (node.type !== 'file') continue;
    const at = node.path.toLowerCase().indexOf(needle);
    if (at === -1) continue;
    const inName = node.name.toLowerCase().includes(needle);
    hits.push({ id: node.id, path: node.path, start: at, end: at + needle.length, inName });
  }
  hits.sort(
    (a, b) =>
      Number(b.inName) - Number(a.inName) ||
      a.path.length - b.path.length ||
      (a.path < b.path ? -1 : a.path > b.path ? 1 : 0),
  );
  return hits.slice(0, limit).map(({ id, path, start, end }) => ({ id, path, start, end }));
}
