import { describe, expect, it } from 'vitest';
import { NativeBackend } from '../../src/services/ingestion/parsing/backends/nativeBackend.js';
import { createParserService } from '../../src/services/ingestion/parsing/parserService.js';

describe('NativeBackend', () => {
  const backend = new NativeBackend();

  it.each([
    ['javascript', "import a from './a';"],
    ['typescript', "import type { T } from './t';"],
    ['tsx', 'const e = <div />;'],
  ])('parses with the %s grammar', (grammar, source) => {
    const tree = backend.parse(grammar, source);
    expect(tree.rootNode.type).toBe('program');
    expect(tree.rootNode.hasError).toBe(false);
  });

  it('parses a source larger than 32 KB (tree-sitter 0.21 needs bufferSize)', () => {
    const source = "import a from './a';\n" + 'const x = 1;\n'.repeat(5000);
    expect(source.length).toBeGreaterThan(32 * 1024);
    expect(backend.parse('javascript', source).rootNode.namedChildren).toHaveLength(5001);
  });

  it('reuses one parser per grammar', () => {
    const b = new NativeBackend();
    b.parse('javascript', 'a;');
    b.parse('javascript', 'b;');
    b.parse('tsx', 'c;');
    expect(b.parsers.size).toBe(2);
  });

  it('rejects an unknown grammar', () => {
    expect(() => backend.parse('python', 'x')).toThrow(/Unknown grammar/);
  });
});

describe('createParserService', () => {
  it('defaults to the native backend and parses', () => {
    const service = createParserService({ backend: 'native' });
    expect(service.backend).toBe('native');
    expect(service.parse('javascript', 'a;').rootNode.type).toBe('program');
  });

  it('reports the D-01 fallback as not implemented', () => {
    expect(() => createParserService({ backend: 'wasm' })).toThrow(/D-01/);
  });

  it('rejects an unknown backend', () => {
    expect(() => createParserService({ backend: 'other' })).toThrow(/Unknown PARSER_BACKEND/);
  });
});
