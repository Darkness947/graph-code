/**
 * Which nodes the canvas draws (spec 8.6 items 1 and 2).
 *
 * A node is visible when every folder above it is expanded. A visible folder is either
 * expanded (drawn as a container around its children) or collapsed (drawn as one node that
 * stands in for everything inside it). On load, every top-level folder starts collapsed,
 * except a wrapper folder (see `wrapperFolders`), which is opened in place.
 */

/** A folder holding at least this share of all files is a wrapper (decision D-05). */
export const WRAPPER_SHARE = 0.6;

const wrapperCache = new WeakMap();

/**
 * Wrapper folders: a top-level folder that holds most of the repository (`src` in a typical
 * app), and the same check repeated inside it. While expanded, a wrapper is drawn without a
 * tray: its children take its place at its level, so no layer of the canvas is spent on a
 * folder that holds everything. Decision D-05, a deliberate deviation from spec 8.6 item 1.
 * @param {{ nodesById: Map<string, any>, childrenByPath: Map<string, string[]> }} index
 * @returns {Set<string>} folder paths, outermost first
 */
export function wrapperFolders(index) {
  let found = wrapperCache.get(index);
  if (found) return found;
  found = new Set();
  let total = 0;
  for (const n of index.nodesById.values()) if (n.type === 'file') total += 1;
  for (let path = ''; total > 0;) {
    const big = (index.childrenByPath.get(path) ?? [])
      .map((id) => index.nodesById.get(id))
      .find((n) => n.type === 'folder' && (n.metrics?.fileCount ?? 0) >= total * WRAPPER_SHARE);
    if (!big) break;
    found.add(big.path);
    path = big.path;
  }
  wrapperCache.set(index, found);
  return found;
}

/**
 * @typedef {{ id: string, kind: 'file' | 'folder', expanded: boolean, parentId: string | null, depth: number }} VisibleNode
 *   `parentId` is the expanded folder that contains the node (`null` at the top level);
 *   `depth` counts those expanded folders.
 */

/**
 * The visible nodes, parents before their children (React Flow needs that order). An expanded
 * wrapper folder is not drawn; its children appear at its level.
 * @param {{ nodesById: Map<string, any>, childrenByPath: Map<string, string[]> }} index
 * @param {Set<string>} expandedFolders folder paths
 * @returns {VisibleNode[]}
 */
export function computeVisibleNodes(index, expandedFolders) {
  const wrappers = wrapperFolders(index);
  const out = [];
  const visit = (folderPath, parentId, depth) => {
    for (const id of index.childrenByPath.get(folderPath) ?? []) {
      const node = index.nodesById.get(id);
      if (node.type !== 'folder') {
        out.push({ id, kind: 'file', expanded: false, parentId, depth });
        continue;
      }
      const expanded = expandedFolders.has(node.path);
      if (expanded && wrappers.has(node.path)) {
        visit(node.path, parentId, depth);
        continue;
      }
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
