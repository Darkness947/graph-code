import { describe, expect, it } from 'vitest';
import { createParserService } from '../../src/services/ingestion/parsing/parserService.js';
import { JavaScriptExtractor } from '../../src/services/ingestion/extractors/javascript/JavaScriptExtractor.js';
import { TypeScriptExtractor } from '../../src/services/ingestion/extractors/typescript/TypeScriptExtractor.js';
import { SourceExtractor } from '../../src/services/ingestion/extractors/SourceExtractor.js';
import { loadFixtureRepo, restrictTree } from '../helpers/fixtures.js';

const parser = createParserService({ backend: 'native' });
const js = new JavaScriptExtractor();
const ts = new TypeScriptExtractor();

function run(extractor, grammar, source) {
  return extractor.extract(restrictTree(parser.parse(grammar, source)), source);
}

const file = (repo, path) => loadFixtureRepo(repo).files.find((f) => f.path === path).content;

describe('JavaScriptExtractor', () => {
  const result = run(js, 'javascript', file('js-forms', 'main.js'));

  it('extracts every import form with kind and line', () => {
    expect(result.imports).toEqual([
      { specifier: './a', kind: 'import', line: 1 },
      { specifier: './b.js', kind: 'import', line: 2 },
      { specifier: './c.jsx', kind: 'import', line: 3 },
      { specifier: './side-effect', kind: 'side_effect', line: 4 },
      { specifier: './d.mjs', kind: 'export_all', line: 5 },
      { specifier: './e.cjs', kind: 'export_from', line: 6 },
      { specifier: './f', kind: 'export_from', line: 7 },
      { specifier: './g', kind: 'require', line: 8 },
      { specifier: './h', kind: 'dynamic_import', line: 9 },
      { specifier: 'react', kind: 'import', line: 12 },
    ]);
  });

  it('reports non-literal require and import() as dynamicUnresolved', () => {
    expect(result.dynamicUnresolved).toEqual([{ line: 10 }, { line: 11 }]);
  });

  it('collects top-level export names without duplicates', () => {
    expect(result.exports).toEqual([
      'thing',
      'space',
      'one',
      'two',
      'fn',
      'Cls',
      'default',
      'renamed',
    ]);
  });

  it('finds require() inside nested functions', () => {
    const r = run(js, 'javascript', "function f() { if (x) { return require('./deep'); } }");
    expect(r.imports).toEqual([{ specifier: './deep', kind: 'require', line: 1 }]);
  });

  it('ignores require.resolve and a shadowing member call', () => {
    const r = run(js, 'javascript', "require.resolve('./x'); obj.require('./y');");
    expect(r.imports).toEqual([]);
    expect(r.dynamicUnresolved).toEqual([]);
  });

  it('returns nothing for an empty file', () => {
    expect(run(js, 'javascript', '')).toEqual({ imports: [], dynamicUnresolved: [], exports: [] });
  });
});

describe('TypeScriptExtractor', () => {
  it('extracts the TypeScript-only import forms', () => {
    const r = run(ts, 'typescript', file('ts-forms', 'main.ts'));
    expect(r.imports).toEqual([
      { specifier: './types', kind: 'import_type', line: 1 },
      { specifier: './values', kind: 'import', line: 2 },
      { specifier: './types2', kind: 'export_type', line: 3 },
      { specifier: './legacy', kind: 'import_equals', line: 4 },
    ]);
  });

  it('collects TypeScript export names', () => {
    const r = run(ts, 'typescript', file('ts-forms', 'main.ts'));
    expect(r.exports).toEqual(['U', 'Shape', 'Alias', 'Color', 'Ns', 'Base']);
  });

  it('parses TSX with the tsx grammar', () => {
    const r = run(ts, 'tsx', file('ts-forms', 'view.tsx'));
    expect(r.imports.map((i) => i.specifier)).toEqual(['react', './values']);
    expect(r.exports).toEqual(['View', 'default']);
  });

  it('still handles the JavaScript forms (it extends JavaScriptExtractor)', () => {
    expect(ts).toBeInstanceOf(JavaScriptExtractor);
    const r = run(ts, 'typescript', "const x = require('./x'); export * from './y';");
    expect(r.imports.map((i) => i.kind)).toEqual(['require', 'export_all']);
  });

  it('treats a default import named "type" as a normal import', () => {
    const r = run(ts, 'typescript', "import type from './x';");
    expect(r.imports[0].kind).toBe('import');
  });
});

describe('SourceExtractor interface', () => {
  it('throws when extract is not implemented', () => {
    expect(() => new SourceExtractor().extract({}, '')).toThrow(/not implemented/);
  });
});

describe('restricted node API', () => {
  it('the test wrapper rejects a disallowed property', () => {
    const tree = restrictTree(parser.parse('javascript', 'a;'));
    expect(() => tree.rootNode.children).toThrow(/disallowed/);
    expect(() => tree.rootNode.walk).toThrow(/disallowed/);
    expect(() => tree.rootText).toThrow(/disallowed/);
  });
});
