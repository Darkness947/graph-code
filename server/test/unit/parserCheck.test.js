import { describe, expect, it } from 'vitest';
import { runParserCheck } from '../../src/parserCheck.js';

describe('parser:check', () => {
  it('parses the JavaScript, TypeScript and TSX samples and prints their imports', () => {
    const lines = [];
    expect(runParserCheck((l) => lines.push(l))).toBe(true);
    expect(lines[0]).toBe('Parser backend: native');
    expect(lines).toHaveLength(4);
    expect(lines[1]).toContain('sample.js (javascript)');
    expect(lines[2]).toContain('"kind":"import_type"');
    expect(lines[3]).toContain('sample.tsx (tsx)');
  });
});
