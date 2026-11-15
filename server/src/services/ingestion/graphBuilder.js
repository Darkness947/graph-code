import { createHash } from 'node:crypto';
import { createDefaultRegistry } from './languages/languageRegistry.js';
import { createParserService } from './parsing/parserService.js';

/**
 * @typedef {{ path: string, language: string, contentHash: string, sizeBytes: number, exports: string[] }} FileInfo
 * @typedef {{ file: FileInfo, plugin: import('./languages/languageRegistry.js').LanguagePlugin,
 *   extraction: { imports: { specifier: string }[], dynamicUnresolved: { line: number }[] } }} ParsedFile
 * @typedef {object} FileGraph
 * @property {FileInfo[]} files
 * @property {{ from: string, to: string }[]} edges importer -> imported
 * @property {{ sourcePath: string, specifier: string, reason: string }[]} unresolved
 * @property {{ path: string, reason: string }[]} skipped
 */

/**
 * Parses one file and extracts its imports and exports (spec 7.5 step 3).
 * @param {{ path: string, content: string }} file
 * @param {{ registry: ReturnType<typeof createDefaultRegistry>, parserService: { parse: Function } }} deps
 * @returns {ParsedFile | { error: 'parse_error' } | null} null for an unsupported extension
 */
export function parseFile(file, { registry, parserService }) {
  const plugin = registry.pluginForPath(file.path);
  if (!plugin) return null;
  let extraction;
  try {
    const tree = parserService.parse(registry.grammarFor(file.path), file.content);
    extraction = plugin.extractor.extract(tree, file.content);
  } catch {
    return { error: 'parse_error' };
  }
  return {
    file: {
      path: file.path,
      language: registry.languageOf(file.path),
      contentHash: createHash('sha256').update(file.content, 'utf8').digest('hex'),
      sizeBytes: Buffer.byteLength(file.content, 'utf8'),
      exports: extraction.exports,
    },
    plugin,
    extraction,
  };
}

/**
 * Resolves the imports of parsed files into edges and unresolved entries (spec 7.5 step 4).
 * Resolution stays inside one language family. Self-imports and duplicate edges are dropped.
 * @param {ParsedFile[]} parsed
 * @param {{ path: string, content: string }[]} configFiles
 * @param {ReturnType<typeof createDefaultRegistry>} registry
 * @returns {Pick<FileGraph, 'edges' | 'unresolved'>}
 */
export function resolveImports(parsed, configFiles, registry) {
  // One resolver and one file index per language family, so concurrent jobs share no state.
  const families = new Map();
  for (const { file, plugin } of parsed) {
    let family = families.get(plugin.resolver);
    if (!family) {
      const resolver = new plugin.resolver();
      const names = new Set(
        registry
          .plugins()
          .filter((p) => p.resolver === plugin.resolver)
          .flatMap((p) => p.configFiles),
      );
      resolver.configure(configFiles.filter((f) => names.has(f.path)));
      family = { resolver, index: new Set() };
      families.set(plugin.resolver, family);
    }
    family.index.add(file.path);
  }

  /** @type {Pick<FileGraph, 'edges' | 'unresolved'>} */
  const out = { edges: [], unresolved: [] };
  const seenEdges = new Set();
  const seenUnresolved = new Set();
  const addUnresolved = (sourcePath, specifier, reason) => {
    const key = `${sourcePath}\u0000${specifier}\u0000${reason}`;
    if (seenUnresolved.has(key)) return;
    seenUnresolved.add(key);
    out.unresolved.push({ sourcePath, specifier, reason });
  };

  for (const { file, plugin, extraction } of parsed) {
    const { path } = file;
    const { resolver, index } = families.get(plugin.resolver);
    if (!resolver.supports(plugin.languageId)) continue;
    for (const { specifier } of extraction.imports) {
      const result = resolver.resolve(specifier, path, index);
      if (result.external) continue;
      if (result.unresolved) {
        addUnresolved(path, specifier, result.unresolved);
      } else if (result.path !== path) {
        const key = `${path}\u0000${result.path}`;
        if (!seenEdges.has(key)) {
          seenEdges.add(key);
          out.edges.push({ from: path, to: result.path });
        }
      }
    }
    for (const { line } of extraction.dynamicUnresolved) {
      addUnresolved(path, `dynamic import (line ${line})`, 'dynamic_import');
    }
  }
  return out;
}

/**
 * Parses every file and resolves its imports in one call (spec 7.5 steps 3 and 4). The pipeline
 * runs the two halves as separate steps (`graphSteps.js`); this is the same work without progress.
 * @param {{ files: { path: string, content: string }[], configFiles?: { path: string, content: string }[] }} input
 * @param {{ registry?: ReturnType<typeof createDefaultRegistry>, parserService?: { parse: Function } }} [deps]
 * @returns {FileGraph}
 */
export function buildFileGraph(
  { files, configFiles = [] },
  { registry = createDefaultRegistry(), parserService = createParserService() } = {},
) {
  const parsed = [];
  const skipped = [];
  for (const file of files) {
    const result = parseFile(file, { registry, parserService });
    if (!result) continue;
    if ('error' in result) skipped.push({ path: file.path, reason: result.error });
    else parsed.push(result);
  }
  return {
    files: parsed.map((p) => p.file),
    ...resolveImports(parsed, configFiles, registry),
    skipped,
  };
}
