/**
 * Interface for language resolvers (spec 7.5.1).
 * `resolve` returns `{ path }`, `{ unresolved: reason }` or `{ external: true }`.
 */
export class LanguageResolver {
  /** @param {string} _languageId */
  supports(_languageId) {
    return false;
  }

  /** @param {{ path: string, content: string }[]} _repoConfigFiles */
  configure(_repoConfigFiles) {}

  /**
   * @param {string} _specifier
   * @param {string} _fromPath repository-relative path of the importing file
   * @param {Set<string>} _fileIndex repository-relative paths of every file of this language family
   * @returns {{ path: string } | { unresolved: string } | { external: true }}
   */
  resolve(_specifier, _fromPath, _fileIndex) {
    throw new Error('LanguageResolver.resolve is not implemented');
  }
}
