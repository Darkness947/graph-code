import { parse as parseJsonc } from 'jsonc-parser';
import { LanguageResolver } from './LanguageResolver.js';

/** Candidate extensions, in the order they are tried (spec 7.5 step 4). */
const EXTENSIONS = ['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs'];

/** TypeScript ESM style: an import written with `.js` may mean a `.ts` or `.tsx` file. */
const JS_TO_TS = { '.js': ['.ts', '.tsx'], '.jsx': ['.tsx'] };

/**
 * Joins a relative specifier to a directory and normalizes it.
 * @param {string} dir repository-relative directory, '' for the root
 * @param {string} rel
 * @returns {string | null} the normalized path, or null if it escapes the repository root
 */
function joinNormalize(dir, rel) {
  const out = dir === '' ? [] : dir.split('/');
  for (const part of rel.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      if (out.length === 0) return null;
      out.pop();
    } else {
      out.push(part);
    }
  }
  return out.join('/');
}

/**
 * Candidate file paths for a normalized path: as written, with each extension,
 * as a directory index, then the `.js` -> `.ts`/`.tsx` mapping.
 * @param {string} p
 * @returns {string[]}
 */
function candidates(p) {
  const list = [p, ...EXTENSIONS.map((e) => p + e), ...EXTENSIONS.map((e) => `${p}/index${e}`)];
  for (const [ext, targets] of Object.entries(JS_TO_TS)) {
    if (p.endsWith(ext)) list.push(...targets.map((t) => p.slice(0, -ext.length) + t));
  }
  return list;
}

/**
 * Splits a `paths` pattern around its single `*`, or returns null when it has none.
 * @param {string} pattern
 */
function splitPattern(pattern) {
  const star = pattern.indexOf('*');
  if (star === -1) return null;
  return { prefix: pattern.slice(0, star), suffix: pattern.slice(star + 1) };
}

/**
 * Resolver for JavaScript and TypeScript (spec 7.5 step 4, "Algorithm 1").
 * `configure` reads the root `tsconfig.json` (else `jsconfig.json`); `extends` is not followed.
 */
export class JsTsResolver extends LanguageResolver {
  constructor() {
    super();
    /** @type {string | null} */
    this.baseUrl = null;
    /** @type {[string, string[]][]} */
    this.paths = [];
  }

  /** @param {string} languageId */
  supports(languageId) {
    return languageId === 'javascript' || languageId === 'typescript';
  }

  /** @param {{ path: string, content: string }[]} repoConfigFiles */
  configure(repoConfigFiles = []) {
    this.baseUrl = null;
    this.paths = [];
    const root = (name) => repoConfigFiles.find((f) => f.path === name);
    const file = root('tsconfig.json') ?? root('jsconfig.json');
    if (!file) return;
    const config = parseJsonc(file.content, [], { allowTrailingComma: true });
    const options = config && typeof config === 'object' ? config.compilerOptions : null;
    if (!options || typeof options !== 'object') return;
    if (typeof options.baseUrl === 'string')
      this.baseUrl = joinNormalize('', options.baseUrl) ?? '';
    if (options.paths && typeof options.paths === 'object') {
      this.paths = Object.entries(options.paths).filter(
        ([, targets]) => Array.isArray(targets) && targets.every((t) => typeof t === 'string'),
      );
    }
  }

  /**
   * @param {string} specifier
   * @param {string} fromPath
   * @param {Set<string>} fileIndex
   * @returns {{ path: string } | { unresolved: string } | { external: true }}
   */
  resolve(specifier, fromPath, fileIndex) {
    const find = (p) => candidates(p).find((c) => fileIndex.has(c));

    if (
      specifier === '.' ||
      specifier === '..' ||
      specifier.startsWith('./') ||
      specifier.startsWith('../')
    ) {
      const dir = fromPath.includes('/') ? fromPath.slice(0, fromPath.lastIndexOf('/')) : '';
      const target = joinNormalize(dir, specifier);
      if (target === null) return { unresolved: 'outside_repo' };
      const hit = find(target);
      return hit ? { path: hit } : { unresolved: 'file_not_found' };
    }
    if (specifier.startsWith('/')) return { unresolved: 'outside_repo' };

    // Path aliases: every mapping is tried in order.
    let aliasMatched = false;
    for (const [pattern, targets] of this.paths) {
      const split = splitPattern(pattern);
      let captured = '';
      if (split) {
        if (
          specifier.length < split.prefix.length + split.suffix.length ||
          !specifier.startsWith(split.prefix) ||
          !specifier.endsWith(split.suffix)
        ) {
          continue;
        }
        captured = specifier.slice(split.prefix.length, specifier.length - split.suffix.length);
      } else if (pattern !== specifier) {
        continue;
      }
      // A bare "*" mapping may legitimately fall through to node_modules.
      if (pattern !== '*') aliasMatched = true;
      for (const target of targets) {
        const substituted = split ? target.replace('*', captured) : target;
        const normalized = joinNormalize(this.baseUrl ?? '', substituted);
        if (normalized === null) continue;
        const hit = find(normalized);
        if (hit) return { path: hit };
      }
    }
    if (aliasMatched) return { unresolved: 'alias_not_found' };

    // baseUrl alone: a non-relative specifier may name a file under it.
    if (this.baseUrl !== null) {
      const normalized = joinNormalize(this.baseUrl, specifier);
      const hit = normalized === null ? undefined : find(normalized);
      if (hit) return { path: hit };
    }

    return { external: true };
  }
}
