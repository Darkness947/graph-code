/**
 * Orders objects by `path` in code-unit order (the same in every locale, so hashes stay stable).
 * @param {{ path: string }} a
 * @param {{ path: string }} b
 * @returns {number}
 */
export const byPath = (a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
