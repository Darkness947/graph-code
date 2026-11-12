import { describe, expect, it } from 'vitest';
import {
  createDefaultRegistry,
  createLanguageRegistry,
} from '../../src/services/ingestion/languages/languageRegistry.js';
import { buildFileGraph } from '../../src/services/ingestion/graphBuilder.js';
import { LanguageResolver } from '../../src/services/ingestion/resolvers/LanguageResolver.js';
import { SourceExtractor } from '../../src/services/ingestion/extractors/SourceExtractor.js';

describe('default registry', () => {
  const registry = createDefaultRegistry();

  it('maps the six supported extensions to a language and grammar', () => {
    expect(registry.supportedExtensions().sort()).toEqual([
      '.cjs',
      '.js',
      '.jsx',
      '.mjs',
      '.ts',
      '.tsx',
    ]);
    expect(registry.grammarFor('src/a.tsx')).toBe('tsx');
    expect(registry.grammarFor('src/a.ts')).toBe('typescript');
    expect(registry.grammarFor('src/a.mjs')).toBe('javascript');
    expect(registry.languageOf('src/A.TS')).toBe('ts');
  });

  it('keeps the root configuration files and ignores unsupported paths', () => {
    expect(registry.configFileNames().sort()).toEqual(['jsconfig.json', 'tsconfig.json']);
    expect(registry.pluginForPath('notes.md')).toBeUndefined();
    expect(registry.pluginForPath('.gitignore')).toBeUndefined();
    expect(registry.languageOf('Makefile')).toBeNull();
  });

  it('rejects a second plugin for the same extension', () => {
    expect(() =>
      registry.register({
        languageId: 'other',
        extensions: ['.ts'],
        grammarIds: {},
        extractor: {},
        resolver: LanguageResolver,
        configFiles: [],
      }),
    ).toThrow(/already registered/);
  });
});

describe('a dummy language plugin', () => {
  class DummyExtractor extends SourceExtractor {
    extract(tree) {
      return {
        imports: tree.lines
          .filter((l) => l.startsWith('use '))
          .map((l, i) => ({
            specifier: l.slice(4),
            kind: 'use',
            line: i + 1,
          })),
        dynamicUnresolved: [],
        exports: [],
      };
    }
  }
  class DummyResolver extends LanguageResolver {
    supports(id) {
      return id === 'dummy';
    }
    configure(files) {
      this.configured = files;
    }
    resolve(specifier, _from, index) {
      return index.has(`${specifier}.dum`)
        ? { path: `${specifier}.dum` }
        : { unresolved: 'file_not_found' };
    }
  }
  const plugin = {
    languageId: 'dummy',
    extensions: ['.dum'],
    grammarIds: { '.dum': 'dummy-grammar' },
    extractor: new DummyExtractor(),
    resolver: DummyResolver,
    configFiles: ['dummy.json'],
  };

  it('is used by the pipeline with no pipeline change', () => {
    const registry = createDefaultRegistry().register(plugin);
    expect(registry.supportedExtensions()).toContain('.dum');
    expect(registry.configFileNames()).toContain('dummy.json');

    const parsedGrammars = [];
    const parserService = {
      parse: (grammar, text) => {
        parsedGrammars.push(grammar);
        return { lines: text.split('\n') };
      },
    };
    const graph = buildFileGraph(
      {
        files: [
          { path: 'a.dum', content: 'use b\nuse missing' },
          { path: 'b.dum', content: '' },
          { path: 'c.js', content: "import './a';" },
        ],
        configFiles: [{ path: 'dummy.json', content: '{}' }],
      },
      {
        registry,
        parserService: {
          parse: (g, t) =>
            g === 'dummy-grammar'
              ? parserService.parse(g, t)
              : {
                  rootNode: {
                    type: 'program',
                    namedChildren: [],
                    startPosition: { row: 0 },
                    text: '',
                    childForFieldName: () => null,
                  },
                },
        },
      },
    );
    expect(parsedGrammars).toEqual(['dummy-grammar', 'dummy-grammar']);
    expect(graph.edges).toEqual([{ from: 'a.dum', to: 'b.dum' }]);
    expect(graph.unresolved).toEqual([
      { sourcePath: 'a.dum', specifier: 'missing', reason: 'file_not_found' },
    ]);
    expect(graph.files.find((f) => f.path === 'a.dum').language).toBe('dum');
  });

  it('never resolves across language families', () => {
    const registry = createLanguageRegistry([...createDefaultRegistry().plugins(), plugin]);
    const graph = buildFileGraph(
      {
        files: [
          { path: 'a.dum', content: 'use c' },
          { path: 'c.js', content: '' },
        ],
      },
      {
        registry,
        parserService: {
          parse: (g, t) =>
            g === 'dummy-grammar'
              ? { lines: t.split('\n') }
              : {
                  rootNode: {
                    type: 'program',
                    namedChildren: [],
                    startPosition: { row: 0 },
                    text: '',
                    childForFieldName: () => null,
                  },
                },
        },
      },
    );
    expect(graph.edges).toEqual([]);
    expect(graph.unresolved).toEqual([
      { sourcePath: 'a.dum', specifier: 'c', reason: 'file_not_found' },
    ]);
  });
});
