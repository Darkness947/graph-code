import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

/** tree-sitter 0.21 throws "Invalid argument" for inputs over 32 KB unless bufferSize is set. */
const MIN_BUFFER_SIZE = 32 * 1024;

/** Loads each grammar package only when first needed. */
const GRAMMAR_LOADERS = {
  javascript: () => require('tree-sitter-javascript'),
  typescript: () => require('tree-sitter-typescript').typescript,
  tsx: () => require('tree-sitter-typescript').tsx,
};

/**
 * Native tree-sitter backend (spec 7.5.1). It knows nothing about imports: it only turns
 * source text into a syntax tree. One `Parser` is created per grammar and reused.
 */
export class NativeBackend {
  constructor() {
    /** @type {Map<string, any>} */
    this.parsers = new Map();
    this.Parser = null;
  }

  /**
   * @param {string} grammarId one of `javascript`, `typescript`, `tsx`
   * @param {string} sourceText
   * @returns {{ rootNode: any }} the syntax tree
   */
  parse(grammarId, sourceText) {
    let parser = this.parsers.get(grammarId);
    if (!parser) {
      const load = GRAMMAR_LOADERS[grammarId];
      if (!load) throw new Error(`Unknown grammar: ${grammarId}`);
      this.Parser ??= require('tree-sitter');
      parser = new this.Parser();
      parser.setLanguage(load());
      this.parsers.set(grammarId, parser);
    }
    const bufferSize = Math.max(MIN_BUFFER_SIZE, sourceText.length * 2 + 1);
    return parser.parse(sourceText, undefined, { bufferSize });
  }
}
