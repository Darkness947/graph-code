import { describe, expect, it } from 'vitest';
import { makeGraph, SAMPLE } from '../../../test/graphFixture.js';
import { buildGraphIndex } from '../graph/graphIndex.js';
import { searchFiles } from './search.js';

const index = buildGraphIndex(SAMPLE);

describe('searchFiles', () => {
  it('matches a substring of the path, ignoring case, and reports the matched range', () => {
    const [hit] = searchFiles(index, 'UTILS');
    expect(hit).toEqual({ id: 'f:src/lib/utils.ts', path: 'src/lib/utils.ts', start: 8, end: 13 });
  });

  it('matches directory parts of the path too', () => {
    expect(searchFiles(index, 'blog').map((h) => h.path)).toEqual(['app/blog/page.tsx']);
  });

  it('returns nothing for an empty, blank or unmatched query, and never folders', () => {
    expect(searchFiles(index, '')).toEqual([]);
    expect(searchFiles(index, '   ')).toEqual([]);
    expect(searchFiles(index, 'zzz')).toEqual([]);
    expect(searchFiles(index, 'deep').map((h) => h.path)).toEqual(['src/lib/deep/math.ts']);
  });

  it('puts file-name matches first, then shorter paths, then alphabetical', () => {
    const idx = buildGraphIndex(
      makeGraph(['page/z.ts', 'a/page.tsx', 'b/page.tsx', 'a/deeper/page.tsx']),
    );
    expect(searchFiles(idx, 'page').map((h) => h.path)).toEqual([
      'a/page.tsx',
      'b/page.tsx',
      'a/deeper/page.tsx',
      'page/z.ts',
    ]);
  });

  it('returns at most 20 results', () => {
    const files = Array.from({ length: 35 }, (_, i) => `src/file${i}.ts`);
    const idx = buildGraphIndex(makeGraph(files));
    expect(searchFiles(idx, 'file')).toHaveLength(20);
    expect(searchFiles(idx, 'file', 5)).toHaveLength(5);
  });
});
