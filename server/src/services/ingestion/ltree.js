import { createHash } from 'node:crypto';

/** Longest encoded segment before the hash is appended (ltree labels have a length limit). */
const MAX_LABEL_BASE = 200;

/**
 * Encodes one path segment as an ltree label (spec 5.3): every character outside
 * [A-Za-z0-9_] becomes `_`, and if anything was replaced the first 8 hex characters of the
 * segment's SHA-1 are appended after `_`, so `[locale]` and `(locale)` never collide.
 * A segment longer than MAX_LABEL_BASE after replacement is truncated and also gets the hash.
 * @param {string} segment
 * @returns {string}
 */
export function encodeSegment(segment) {
  let changed = false;
  let out = '';
  for (const ch of segment) {
    if (/[A-Za-z0-9_]/.test(ch)) {
      out += ch;
    } else {
      out += '_';
      changed = true;
    }
  }
  if (out.length > MAX_LABEL_BASE) {
    out = out.slice(0, MAX_LABEL_BASE);
    changed = true;
  }
  if (!changed) return out;
  const hash = createHash('sha1').update(segment, 'utf8').digest('hex').slice(0, 8);
  return `${out}_${hash}`;
}

/**
 * Encodes a repository-relative path as an ltree value, prefixed with the root label `r`.
 * The empty path (the repository root) is just `r`.
 * @param {string} path forward-slash separated, no leading slash
 * @returns {string}
 */
export function encodePathLtree(path) {
  if (path === '') return 'r';
  return ['r', ...path.split('/').map(encodeSegment)].join('.');
}
