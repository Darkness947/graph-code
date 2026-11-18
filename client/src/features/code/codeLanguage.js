/** Helpers for the code drawer (spec 8.6). */

/**
 * Highlighting runs synchronously, so a very long file would freeze the tab. Past this many
 * lines the drawer shows plain text with line numbers.
 */
export const MAX_HIGHLIGHT_LINES = 3000;

/**
 * The Prism language for a file, from its extension (Demo 1 supports `.js .jsx .mjs .cjs .ts .tsx`).
 * @param {string} path
 * @returns {string}
 */
export function prismLanguage(path) {
  const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
  if (ext === 'ts') return 'typescript';
  if (ext === 'tsx') return 'tsx';
  return 'jsx';
}

/**
 * A `prism-react-renderer` theme built from the design tokens (spec 8.1). Red and gold are
 * reserved for AI risk, so they are not used.
 */
export const codeTheme = {
  plain: { color: 'var(--text-primary)', backgroundColor: 'transparent' },
  styles: [
    { types: ['comment', 'prolog', 'doctype', 'cdata'], style: { color: 'var(--text-secondary)' } },
    {
      types: ['keyword', 'operator', 'atrule', 'tag', 'selector'],
      style: { color: 'var(--accent-blue)' },
    },
    {
      types: ['string', 'char', 'template-string', 'attr-value', 'regex'],
      style: { color: 'var(--success-green)' },
    },
    { types: ['function', 'class-name', 'builtin'], style: { fontWeight: '600' } },
    { types: ['punctuation'], style: { color: 'var(--text-secondary)' } },
  ],
};
