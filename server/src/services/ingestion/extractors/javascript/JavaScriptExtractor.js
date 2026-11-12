import { SourceExtractor } from '../SourceExtractor.js';

/**
 * Removes the quotes from a `string` node. Returns null for anything that is not a plain string.
 * @param {any} node
 * @returns {string | null}
 */
export function stringValue(node) {
  if (!node || node.type !== 'string') return null;
  return node.text.slice(1, -1);
}

/**
 * Extracts import specifiers and export names from JavaScript (spec 7.5).
 * Walks the tree with the allowed node API only; no tree-sitter queries.
 */
export class JavaScriptExtractor extends SourceExtractor {
  /**
   * @param {{ rootNode: any }} tree
   * @param {string} _sourceText
   * @returns {import('../SourceExtractor.js').Extraction}
   */
  extract(tree, _sourceText) {
    const imports = [];
    const dynamicUnresolved = [];
    const exports = [];
    const seenExports = new Set();
    const addExport = (name) => {
      if (name && !seenExports.has(name)) {
        seenExports.add(name);
        exports.push(name);
      }
    };

    // Iterative pre-order walk, so very deep trees cannot overflow the stack.
    const stack = [tree.rootNode];
    while (stack.length > 0) {
      const node = stack.pop();
      const line = node.startPosition.row + 1;

      if (node.type === 'import_statement' || node.type === 'export_statement') {
        const source = stringValue(node.childForFieldName('source'));
        if (source !== null) {
          imports.push({ specifier: source, kind: this.kindOf(node), line });
        }
        if (node.type === 'export_statement' && node.parent?.type === 'program') {
          this.collectExportNames(node, addExport);
        }
      } else if (node.type === 'call_expression') {
        this.handleCall(node, line, imports, dynamicUnresolved);
      } else {
        this.handleExtra(node, line, imports);
      }

      const children = node.namedChildren;
      for (let i = children.length - 1; i >= 0; i--) stack.push(children[i]);
    }

    return { imports, dynamicUnresolved, exports };
  }

  /**
   * Classifies an import or export statement that has a source string.
   * @param {any} node
   * @returns {string}
   */
  kindOf(node) {
    if (node.type === 'import_statement') {
      return node.namedChildren.some((c) => c.type === 'import_clause') ? 'import' : 'side_effect';
    }
    return node.namedChildren.some(
      (c) => c.type === 'export_clause' || c.type === 'namespace_export',
    )
      ? 'export_from'
      : 'export_all';
  }

  /**
   * Hook for subclasses to handle node types the base language does not know.
   * @param {any} _node
   * @param {number} _line
   * @param {any[]} _imports
   */
  handleExtra(_node, _line, _imports) {}

  /** `require('x')` and `import('x')`; a non-literal argument is a dynamic import. */
  handleCall(node, line, imports, dynamicUnresolved) {
    const fn = node.childForFieldName('function');
    if (!fn) return;
    const isRequire = fn.type === 'identifier' && fn.text === 'require';
    const isImport = fn.type === 'import';
    if (!isRequire && !isImport) return;
    const args = node.childForFieldName('arguments');
    const first = args ? args.namedChildren[0] : undefined;
    const value = stringValue(first);
    if (value === null) {
      dynamicUnresolved.push({ line });
    } else {
      imports.push({ specifier: value, kind: isRequire ? 'require' : 'dynamic_import', line });
    }
  }

  /**
   * Names of top-level exports of one `export_statement`.
   * @param {any} node
   * @param {(name: string | undefined) => void} add
   */
  collectExportNames(node, add) {
    const declaration = node.childForFieldName('declaration');
    if (declaration) {
      if (
        declaration.type === 'lexical_declaration' ||
        declaration.type === 'variable_declaration'
      ) {
        for (const d of declaration.namedChildren) {
          if (d.type === 'variable_declarator') add(d.childForFieldName('name')?.text);
        }
      } else {
        add(declaration.childForFieldName('name')?.text);
      }
      return;
    }
    if (isDefaultExport(node)) {
      add('default');
      return;
    }
    for (const child of node.namedChildren) {
      if (child.type === 'export_clause') {
        for (const spec of child.namedChildren) {
          const name = spec.childForFieldName('alias') ?? spec.childForFieldName('name');
          add(name?.text);
        }
      } else if (child.type === 'namespace_export') {
        add(child.namedChildren[0]?.text);
      }
    }
  }
}

/** `export default …` (the keyword is anonymous, so it is read from the statement text). */
function isDefaultExport(node) {
  return /^export\s+default\b/.test(node.text);
}
