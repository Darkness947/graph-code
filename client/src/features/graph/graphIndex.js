/**
 * The workspace's in-memory graph (spec 8.8): `{ nodesById, childrenByPath, edges }`, built
 * once from the `Graph` returned by `GET /api/repos/:id/graph` (spec 6.2).
 *
 * - `nodesById`: `Map<id, node>` with the node exactly as the API returned it.
 * - `childrenByPath`: `Map<folderPath, childId[]>`. The root folder is `""`. Children are
 *   ordered folders first, then by name, the same order as the directory tree.
 * - `edges`: the API edges unchanged, importer -> imported.
 */

const byName = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

/**
 * @param {{ nodes: object[], edges: object[] }} graph
 * @returns {{ nodesById: Map<string, any>, childrenByPath: Map<string, string[]>, edges: object[] }}
 */
export function buildGraphIndex(graph) {
  const nodesById = new Map();
  const childrenByPath = new Map([['', []]]);

  for (const node of graph.nodes) {
    nodesById.set(node.id, node);
    if (node.type === 'folder' && !childrenByPath.has(node.path)) childrenByPath.set(node.path, []);
  }
  for (const node of graph.nodes) {
    const siblings = childrenByPath.get(node.parentPath ?? '');
    if (siblings) siblings.push(node.id);
    else childrenByPath.set(node.parentPath ?? '', [node.id]);
  }
  for (const ids of childrenByPath.values()) {
    ids.sort((a, b) => {
      const x = nodesById.get(a);
      const y = nodesById.get(b);
      if (x.type !== y.type) return x.type === 'folder' ? -1 : 1;
      return byName.compare(x.name, y.name);
    });
  }

  return { nodesById, childrenByPath, edges: graph.edges };
}

const fileIdsByIndex = new WeakMap();

/**
 * `Map<path, id>` of the index's files, built once per index. Kept beside the index rather than
 * in it, so the spec 8.8 `graph` shape stays as defined.
 * @param {{ nodesById: Map<string, any> }} index
 * @returns {Map<string, string>}
 */
export function fileIdByPath(index) {
  let map = fileIdsByIndex.get(index);
  if (!map) {
    map = new Map();
    for (const n of index.nodesById.values()) if (n.type === 'file') map.set(n.path, n.id);
    fileIdsByIndex.set(index, map);
  }
  return map;
}
