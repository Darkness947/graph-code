import { buffer } from 'node:stream/consumers';
import yazl from 'yazl';

/** The top-level folder GitHub puts in every archive: `<repo>-<sha>/`. */
export const ARCHIVE_ROOT = 'repo-0123456789abcdef0123456789abcdef01234567';

/**
 * Builds a ZIP in memory with `yazl`, shaped like a GitHub archive.
 * @param {Record<string, string | Buffer>} files path -> content; a path ending in `/` is a directory
 * @param {{ root?: string | null, compress?: boolean }} [options] `root: null` adds no top folder
 * @returns {Promise<Buffer>}
 */
export function buildZip(files, { root = ARCHIVE_ROOT, compress = true } = {}) {
  const zip = new yazl.ZipFile();
  if (root) zip.addEmptyDirectory(root);
  for (const [path, content] of Object.entries(files)) {
    const full = root ? `${root}/${path}` : path;
    if (path.endsWith('/')) zip.addEmptyDirectory(full.slice(0, -1));
    else zip.addBuffer(Buffer.from(content), full, { compress });
  }
  zip.end();
  return buffer(zip.outputStream);
}

/**
 * Renames an entry by replacing its name bytes (local header and central directory). `yazl`
 * refuses to write unsafe names such as `../x`, so tests write a same-length placeholder first.
 * @param {Buffer} zip
 * @param {string} from
 * @param {string} to must have the same byte length as `from`
 * @returns {Buffer} a patched copy
 */
export function renameEntry(zip, from, to) {
  const a = Buffer.from(from);
  const b = Buffer.from(to);
  if (a.length !== b.length) throw new Error('renameEntry needs names of equal length');
  const out = Buffer.from(zip);
  let count = 0;
  for (let at = out.indexOf(a); at !== -1; at = out.indexOf(a, at + a.length)) {
    b.copy(out, at);
    count++;
  }
  if (count !== 2) throw new Error(`renameEntry expected 2 occurrences of ${from}, found ${count}`);
  return out;
}
