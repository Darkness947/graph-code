/**
 * @typedef {{ specifier: string, kind: string, line: number }} ImportEntry
 * @typedef {{ imports: ImportEntry[], dynamicUnresolved: { line: number }[], exports: string[] }} Extraction
 */

/**
 * Interface for language extractors (spec 7.5.1). An extractor reads a syntax tree and may use
 * ONLY: `type`, `text`, `startPosition`, `namedChildren`, `childForFieldName`, `parent`, and the
 * tree's `rootNode`. That restriction keeps the parsing backend swappable.
 */
export class SourceExtractor {
  /**
   * @param {{ rootNode: any }} _tree
   * @param {string} _sourceText
   * @returns {Extraction}
   */
  extract(_tree, _sourceText) {
    throw new Error('SourceExtractor.extract is not implemented');
  }
}
