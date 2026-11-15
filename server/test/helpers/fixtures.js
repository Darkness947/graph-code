import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildZip } from './zip.js';

const REPOS = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'repos');

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

/** Every file of a fixture repository as `{ path, content }`, with repository-relative paths. */
function fixtureFiles(name) {
  const root = join(REPOS, name);
  return walk(root).map((full) => ({
    path: relative(root, full).split(sep).join('/'),
    content: readFileSync(full, 'utf8'),
  }));
}

/**
 * Loads a fixture repository as `{ files, configFiles }` with repository-relative paths.
 * Only root `tsconfig.json` / `jsconfig.json` count as configuration files.
 * @param {string} name directory under test/fixtures/repos
 */
export function loadFixtureRepo(name) {
  const all = fixtureFiles(name);
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
  const entries = Object.fromEntries(fixtureFiles(name).map((f) => [f.path, f.content]));
  return buildZip({ ...entries, ...extra });
}

/** Marks source text that `failingParser` refuses to parse. */
export const PARSE_ERROR_MARKER = 'TEST_ONLY_FORCE_PARSE_ERROR';

/**
 * A parser service that throws for source containing PARSE_ERROR_MARKER (the parser API takes no
 * path) and otherwise delegates, to exercise the `parse_error` skip.
 * @param {{ parse: Function }} base
 */
export function failingParser(base) {
  return {
    parse: (grammar, text) => {
      if (text.includes(PARSE_ERROR_MARKER)) throw new Error('forced parse error');
      return base.parse(grammar, text);
    },
  };
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
