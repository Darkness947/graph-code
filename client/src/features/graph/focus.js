/**
 * Focus mode (spec 8.6 item 8): the selected file and its 1–2 hop structural neighbours, in
 * both directions. "Both directions" means what the file imports (and what those import) and
 * what imports it (and what imports those); files that merely share an import with it are not
 * neighbours.
 */

export const FOCUS_HOPS = 2;

/**
 * @param {{ edges: Array<{ source: string, target: string }> }} index
 * @param {string} fileId
 * @returns {string[]} the file id first, then its neighbours (ids of files)
 */
export function computeFocusSet(index, fileId) {
  const out = new Map();
  const into = new Map();
  for (const { source, target } of index.edges) {
    if (!out.has(source)) out.set(source, []);
    out.get(source).push(target);
    if (!into.has(target)) into.set(target, []);
    into.get(target).push(source);
  }
  const found = new Set([fileId]);
  for (const links of [out, into]) {
    let frontier = [fileId];
    for (let hop = 0; hop < FOCUS_HOPS && frontier.length; hop++) {
      const next = [];
      for (const id of frontier) {
        for (const other of links.get(id) ?? []) {
          if (!found.has(other)) {
            found.add(other);
            next.push(other);
          }
        }
      }
      frontier = next;
    }
  }
  return [...found];
}

/**
 * The drawn nodes a focus set lights up: each file's nearest visible ancestor (the file itself
 * or a collapsed folder, `ancestors` from `buildVisibleAncestorMap`) plus the expanded folders
 * around them, so a tray holding a highlighted file is not dimmed.
 * @param {string[]} nodeIds focus set
 * @param {Map<string, string>} ancestors file id -> visible node id
 * @param {Map<string, string | null>} parentOf visible node id -> expanded folder holding it
 * @returns {Set<string>}
 */
export function highlightedVisibleIds(nodeIds, ancestors, parentOf) {
  const lit = new Set();
  for (const id of nodeIds) {
    for (let cur = ancestors.get(id); cur != null && !lit.has(cur); cur = parentOf.get(cur)) {
      lit.add(cur);
    }
  }
  return lit;
}
