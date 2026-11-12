import { JavaScriptExtractor, stringValue } from '../javascript/JavaScriptExtractor.js';

/**
 * Adds the TypeScript-only forms to the JavaScript extractor: `import type … from`,
 * `export type … from` and `import x = require('x')` (spec 7.5).
 */
export class TypeScriptExtractor extends JavaScriptExtractor {
  kindOf(node) {
    if (
      node.type === 'import_statement' &&
      /^import\s+type(?=[\s{*])(?!\s+from\b)/.test(node.text)
    ) {
      return 'import_type';
    }
    if (node.type === 'export_statement' && /^export\s+type(?=[\s{*])/.test(node.text)) {
      return 'export_type';
    }
    return super.kindOf(node);
  }

  handleExtra(node, line, imports) {
    if (node.type !== 'import_require_clause') return;
    const value = stringValue(node.namedChildren.find((c) => c.type === 'string'));
    if (value !== null) imports.push({ specifier: value, kind: 'import_equals', line });
  }
}
