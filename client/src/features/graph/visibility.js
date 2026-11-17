/**
 * Which nodes the canvas draws (spec 8.6 items 1 and 2).
 *
 * A node is visible when every folder above it is expanded. A visible folder is either
 * expanded (drawn as a container around its children) or collapsed (drawn as one node that
 * stands in for everything inside it). Nothing is expanded on load, so every top-level folder
 * starts collapsed.
 */

/**
 * @typedef {{ id: string, kind: 'file' | 'folder', expanded: boolean, parentId: string | null, depth: number }} VisibleNode
 *   `parentId` is the expanded folder that contains the node (`null` at the top level);
 *   `depth` counts those expanded folders.
 */

/**
 * The visible nodes, parents before their children (React Flow needs that order).
 * @param {{ nodesById: Map<string, any>, childrenByPath: Map<string, string[]> }} index
 * @param {Set<string>} expandedFolders folder paths
 * @returns {VisibleNode[]}
 */
export function computeVisibleNodes(index, expandedFolders) {
  const out = [];
  const visit = (folderPath, parentId, depth) => {
    for (const id of index.childrenByPath.get(folderPath) ?? []) {
      const node = index.nodesById.get(id);
      if (node.type !== 'folder') {
        out.push({ id, kind: 'file', expanded: false, parentId, depth });
        continue;
      }
      const expanded = expandedFolders.has(node.path);
      out.push({ id, kind: 'folder', expanded, parentId, depth });
      if (expanded) visit(node.path, id, depth + 1);
    }
  };
  visit('', null, 0);
  return out;
}

/**
 * Maps every file to its nearest visible ancestor: the file itself when all its folders are
 * expanded, otherwise the outermost collapsed folder above it.
 * @param {{ nodesById: Map<string, any>, childrenByPath: Map<string, string[]> }} index
 * @param {Set<string>} expandedFolders folder paths
 * @returns {Map<string, string>} file id -> visible node id
 */
export function buildVisibleAncestorMap(index, expandedFolders) {
  const map = new Map();
  const visit = (folderPath, collapsedId) => {
    for (const id of index.childrenByPath.get(folderPath) ?? []) {
      const node = index.nodesById.get(id);
      if (node.type === 'folder') {
        const stand = collapsedId ?? (expandedFolders.has(node.path) ? null : id);
        visit(node.path, stand);
      } else {
        map.set(id, collapsedId ?? id);
      }
    }
  };
  visit('', null);
  return map;
}

/**
 * A folder path and every folder above it, outermost first: the folders to expand to open it.
 * @param {string} path
 * @returns {string[]}
 */
export function folderChain(path) {
  const parts = path.split('/');
  return parts.map((_, i) => parts.slice(0, i + 1).join('/'));
}
