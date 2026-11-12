import { JavaScriptExtractor } from '../extractors/javascript/JavaScriptExtractor.js';
import { TypeScriptExtractor } from '../extractors/typescript/TypeScriptExtractor.js';
import { JsTsResolver } from '../resolvers/jsTsResolver.js';

/**
 * @typedef {object} LanguagePlugin
 * @property {string} languageId
 * @property {string[]} extensions lower-case, with the leading dot
 * @property {Record<string, string>} grammarIds extension -> grammar id for the parsing backend
 * @property {{ extract: Function }} extractor
 * @property {new () => import('../resolvers/LanguageResolver.js').LanguageResolver} resolver
 *   a resolver class; plugins sharing one class are one language family and resolve into each other
 * @property {string[]} configFiles repository-root file names the extraction step keeps
 */

/** Lower-case extension of a path, with the dot ('' when there is none). */
function extensionOf(path) {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  return dot <= 0 ? '' : name.slice(dot).toLowerCase();
}

/**
 * Maps file extensions to language plugins (spec 7.5.1). The supported extensions, the kept
 * configuration files and each node's `language` all derive from here.
 * @param {LanguagePlugin[]} [initial]
 */
export function createLanguageRegistry(initial = []) {
  /** @type {Map<string, LanguagePlugin>} */
  const byExtension = new Map();
  /** @type {LanguagePlugin[]} */
  const plugins = [];

  const registry = {
    /** @param {LanguagePlugin} plugin */
    register(plugin) {
      for (const ext of plugin.extensions) {
        if (byExtension.has(ext)) throw new Error(`Extension ${ext} is already registered`);
      }
      plugins.push(plugin);
      for (const ext of plugin.extensions) byExtension.set(ext, plugin);
      return registry;
    },
    /** @param {string} path */
    pluginForPath: (path) => byExtension.get(extensionOf(path)),
    /** The `language` value stored on a node: the extension without its dot (`ts`, `tsx`, `js`). */
    languageOf(path) {
      return byExtension.has(extensionOf(path)) ? extensionOf(path).slice(1) : null;
    },
    /** @param {string} path */
    grammarFor(path) {
      const plugin = byExtension.get(extensionOf(path));
      return plugin ? plugin.grammarIds[extensionOf(path)] : undefined;
    },
    supportedExtensions: () => [...byExtension.keys()],
    configFileNames: () => [...new Set(plugins.flatMap((p) => p.configFiles))],
    plugins: () => [...plugins],
  };
  for (const plugin of initial) registry.register(plugin);
  return registry;
}

/** @type {LanguagePlugin[]} */
export const DEFAULT_PLUGINS = [
  {
    languageId: 'javascript',
    extensions: ['.js', '.jsx', '.mjs', '.cjs'],
    grammarIds: {
      '.js': 'javascript',
      '.jsx': 'javascript',
      '.mjs': 'javascript',
      '.cjs': 'javascript',
    },
    extractor: new JavaScriptExtractor(),
    resolver: JsTsResolver,
    configFiles: ['tsconfig.json', 'jsconfig.json'],
  },
  {
    languageId: 'typescript',
    extensions: ['.ts', '.tsx'],
    grammarIds: { '.ts': 'typescript', '.tsx': 'tsx' },
    extractor: new TypeScriptExtractor(),
    resolver: JsTsResolver,
    configFiles: ['tsconfig.json', 'jsconfig.json'],
  },
];

export function createDefaultRegistry() {
  return createLanguageRegistry(DEFAULT_PLUGINS);
}
