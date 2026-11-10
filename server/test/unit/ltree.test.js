import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { encodePathLtree, encodeSegment } from '../../src/services/ingestion/ltree.js';

const sha8 = (s) => createHash('sha1').update(s, 'utf8').digest('hex').slice(0, 8);

describe('encodeSegment', () => {
  it('leaves letters, digits and underscores unchanged, without a hash', () => {
    expect(encodeSegment('src')).toBe('src');
    expect(encodeSegment('My_File2')).toBe('My_File2');
  });

  it('replaces brackets and appends the SHA-1 prefix of the original segment', () => {
    expect(encodeSegment('[id]')).toBe(`_id__${sha8('[id]')}`);
  });

  it('replaces dots (file extensions)', () => {
    expect(encodeSegment('page.tsx')).toBe(`page_tsx_${sha8('page.tsx')}`);
  });

  it('replaces dashes', () => {
    expect(encodeSegment('my-component')).toBe(`my_component_${sha8('my-component')}`);
  });

  it('replaces spaces', () => {
    expect(encodeSegment('my file')).toBe(`my_file_${sha8('my file')}`);
  });

  it('replaces @', () => {
    expect(encodeSegment('@types')).toBe(`_types_${sha8('@types')}`);
  });

  it('replaces each non-ASCII character with one underscore', () => {
    expect(encodeSegment('café')).toBe(`caf__${sha8('café')}`);
    expect(encodeSegment('日本語')).toBe(`____${sha8('日本語')}`);
  });

  it('keeps segments that differ only in replaced characters apart', () => {
    expect(encodeSegment('[locale]')).not.toBe(encodeSegment('(locale)'));
    expect(encodeSegment('a-b')).not.toBe(encodeSegment('a.b'));
  });

  it('truncates very long segments and still appends the hash', () => {
    const long = 'a'.repeat(500);
    const out = encodeSegment(long);
    expect(out).toBe(`${'a'.repeat(200)}_${sha8(long)}`);
  });

  it('only produces valid ltree label characters', () => {
    for (const s of ['[id]', 'a b', 'ünï', '@x', 'x.y-z']) {
      expect(encodeSegment(s)).toMatch(/^[A-Za-z0-9_]+$/);
    }
  });
});

describe('encodePathLtree', () => {
  it('returns the root label for the empty path', () => {
    expect(encodePathLtree('')).toBe('r');
  });

  it('prefixes plain paths with r and joins with dots', () => {
    expect(encodePathLtree('src')).toBe('r.src');
    expect(encodePathLtree('src/lib')).toBe('r.src.lib');
  });

  it('encodes the spec example path', () => {
    expect(encodePathLtree('src/app/[id]/page.tsx')).toBe(
      `r.src.app._id__${sha8('[id]')}.page_tsx_${sha8('page.tsx')}`,
    );
  });

  it('gives a folder and its children a prefix relationship', () => {
    const folder = encodePathLtree('src/[id]');
    const child = encodePathLtree('src/[id]/page.tsx');
    expect(child.startsWith(`${folder}.`)).toBe(true);
  });
});
