import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildZip } from './zip.js';

const REPOS = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'repos');

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

/**
 * Loads a fixture repository as `{ files, configFiles }` with repository-relative paths.
 * Only root `tsconfig.json` / `jsconfig.json` count as configuration files.
 * @param {string} name directory under test/fixtures/repos
 */
export function loadFixtureRepo(name) {
  const root = join(REPOS, name);
  const all = walk(root).map((full) => ({
    path: relative(root, full).split('\\').join('/'),
    content: readFileSync(full, 'utf8'),
  }));
  const isConfig = (f) => f.path === 'tsconfig.json' || f.path === 'jsconfig.json';
  return { files: all.filter((f) => !isConfig(f)), configFiles: all.filter(isConfig) };
}

/**
 * Zips a fixture repository with `yazl`, shaped like a GitHub archive (spec 7.5 step 2).
 * @param {string} name directory under test/fixtures/repos
 * @param {Record<string, string>} [extra] more entries, e.g. ones git cannot hold (`node_modules/`)
 * @returns {Promise<Buffer>}
 */
export function zipFixtureRepo(name, extra = {}) {
  const root = join(REPOS, name);
  const entries = Object.fromEntries(
    walk(root).map((full) => [relative(root, full).split('\\').join('/'), readFileSync(full)]),
  );
  return buildZip({ ...entries, ...extra });
}

/** Wraps a syntax tree so any node property outside the allowed extractor API throws. */
export function restrictTree(tree) {
  const ALLOWED = new Set([
    'type',
    'text',
    'startPosition',
    'namedChildren',
    'childForFieldName',
    'parent',
    'rootNode',
  ]);
  const wrap = (value) => {
    if (Array.isArray(value)) return value.map(wrap);
    if (value && typeof value === 'object' && 'type' in value) return wrapNode(value);
    return value;
  };
  const wrapNode = (node) =>
    new Proxy(node, {
      get(target, prop) {
        if (typeof prop === 'symbol') return Reflect.get(target, prop);
        if (!ALLOWED.has(prop))
          throw new Error(`Extractor used a disallowed node property: ${prop}`);
        const value = target[prop];
        if (prop === 'childForFieldName') return (name) => wrap(target.childForFieldName(name));
        return wrap(value);
      },
    });
  return new Proxy(tree, {
    get(target, prop) {
      if (prop !== 'rootNode')
        throw new Error(`Extractor used a disallowed tree property: ${String(prop)}`);
      return wrapNode(target.rootNode);
    },
  });
}
