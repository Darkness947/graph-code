/**
 * Which nodes the canvas draws (spec 8.6 items 1 and 2).
 *
 * A node is visible when every folder above it is expanded. A visible folder is either
 * expanded (drawn as a container around its children) or collapsed (drawn as one node that
 * stands in for everything inside it). On load, every top-level folder starts collapsed,
 * except a wrapper folder (see `wrapperFolders`), which is opened in place. Opening any folder
 * also opens the wrapper chain below it (`wrapperChain`).
 */

/** A folder holding at least this share of all files is a wrapper (decision D-05). */
export const WRAPPER_SHARE = 0.6;

const wrapperCache = new WeakMap();

const fileCount = (node) => node.metrics?.fileCount ?? 0;

const folderChildren = (index, path) =>
  (index.childrenByPath.get(path) ?? [])
    .map((id) => index.nodesById.get(id))
    .filter((n) => n.type === 'folder');

const totalFiles = (index) => {
  let total = 0;
  for (const n of index.nodesById.values()) if (n.type === 'file') total += 1;
  return total;
};

/**
 * Below the top level, a folder needs at least this many files before a wrapper is looked for
 * inside it: in a small folder a nested tray costs little and its grouping still means something.
 */
export const WRAPPER_MIN_FILES = 10;

/** The child folder of `path` holding at least `WRAPPER_SHARE` of its `size` files, if any. */
const wrapperChild = (index, path, size) =>
  size > 0 && (path === '' || size >= WRAPPER_MIN_FILES)
    ? folderChildren(index, path).find((n) => fileCount(n) >= size * WRAPPER_SHARE)
    : undefined;

/**
 * Wrapper folders: a folder holding most of its parent folder's files (`src` in a typical app,
 * `client/src` and `server/src` in a client-server repository); at the top level the share is
 * measured against all files. While expanded, a wrapper is drawn without a tray: its children
 * take its place at its parent's level, so no layer of the canvas is spent on a folder that
 * holds nearly everything around it. Decision D-05, a deliberate deviation from spec 8.6 item 1.
 * @param {{ nodesById: Map<string, any>, childrenByPath: Map<string, string[]> }} index
 * @returns {Set<string>} folder paths, parents before their children
 */
export function wrapperFolders(index) {
  let found = wrapperCache.get(index);
  if (found) return found;
  found = new Set();
  const visit = (path, size) => {
    const big = wrapperChild(index, path, size);
    if (big) found.add(big.path);
    for (const folder of folderChildren(index, path)) visit(folder.path, fileCount(folder));
  };
  visit('', totalFiles(index));
  wrapperCache.set(index, found);
  return found;
}

/**
 * The wrapper folders that open together with `path`: its wrapper child, that folder's own
 * wrapper child, and so on. With `path` = '' these are the folders opened on load.
 * @param {{ nodesById: Map<string, any>, childrenByPath: Map<string, string[]> }} index
 * @param {string} path folder path, '' for the root
 * @returns {string[]} outermost first
 */
export function wrapperChain(index, path) {
  const wrappers = wrapperFolders(index);
  const chain = [];
  for (let at = path; ;) {
    const next = folderChildren(index, at).find((n) => wrappers.has(n.path));
    if (!next) return chain;
    chain.push(next.path);
    at = next.path;
  }
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
