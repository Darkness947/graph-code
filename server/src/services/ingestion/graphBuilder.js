import { createHash } from 'node:crypto';
import { createDefaultRegistry } from './languages/languageRegistry.js';
import { createParserService } from './parsing/parserService.js';

/**
 * @typedef {object} FileGraph
 * @property {{ path: string, language: string, contentHash: string, sizeBytes: number, exports: string[] }[]} files
 * @property {{ from: string, to: string }[]} edges importer -> imported
 * @property {{ sourcePath: string, specifier: string, reason: string }[]} unresolved
 * @property {{ path: string, reason: string }[]} skipped
 */

/**
 * Parses every file, extracts imports and resolves them into edges (spec 7.5 steps 3 and 4).
 * Resolution stays inside one language family. Self-imports and duplicate edges are dropped.
 * Folder nodes, metrics and progress belong to T2.4.
 * @param {{ files: { path: string, content: string }[], configFiles?: { path: string, content: string }[] }} input
 * @param {{ registry?: ReturnType<typeof createDefaultRegistry>, parserService?: { parse: Function } }} [deps]
 * @returns {FileGraph}
 */
export function buildFileGraph(
  { files, configFiles = [] },
  { registry = createDefaultRegistry(), parserService = createParserService() } = {},
) {
  /** @type {FileGraph} */
  const graph = { files: [], edges: [], unresolved: [], skipped: [] };
  const parsed = [];

  for (const file of files) {
    const plugin = registry.pluginForPath(file.path);
    if (!plugin) continue;
    let extraction;
    try {
      const tree = parserService.parse(registry.grammarFor(file.path), file.content);
      extraction = plugin.extractor.extract(tree, file.content);
    } catch {
      graph.skipped.push({ path: file.path, reason: 'parse_error' });
      continue;
    }
    graph.files.push({
      path: file.path,
      language: registry.languageOf(file.path),
      contentHash: createHash('sha256').update(file.content, 'utf8').digest('hex'),
      sizeBytes: Buffer.byteLength(file.content, 'utf8'),
      exports: extraction.exports,
    });
    parsed.push({ path: file.path, plugin, extraction });
  }

  // One resolver and one file index per language family, so concurrent jobs share no state.
  const families = new Map();
  for (const { path, plugin } of parsed) {
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
    family.index.add(path);
  }

  const seenEdges = new Set();
  const seenUnresolved = new Set();
  const addUnresolved = (sourcePath, specifier, reason) => {
    const key = `${sourcePath}\u0000${specifier}\u0000${reason}`;
    if (seenUnresolved.has(key)) return;
    seenUnresolved.add(key);
    graph.unresolved.push({ sourcePath, specifier, reason });
  };

  for (const { path, plugin, extraction } of parsed) {
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
          graph.edges.push({ from: path, to: result.path });
        }
      }
    }
    for (const { line } of extraction.dynamicUnresolved) {
      addUnresolved(path, `dynamic import (line ${line})`, 'dynamic_import');
    }
  }
  return graph;
}
