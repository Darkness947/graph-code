import { describe, expect, it } from 'vitest';
import { makeGraph, SAMPLE } from '../../../test/graphFixture.js';
import { aggregateEdges } from './aggregation.js';
import { buildGraphIndex } from './graphIndex.js';
import { buildVisibleAncestorMap } from './visibility.js';

const visibleEdges = (graph, expanded) => {
  const index = buildGraphIndex(graph);
  return aggregateEdges(
    index.edges,
    buildVisibleAncestorMap(index, new Set(expanded)),
    index.nodesById,
  );
};
const byId = (edges) => Object.fromEntries(edges.map((e) => [e.id, e]));

describe('aggregateEdges', () => {
  it('maps an edge into a collapsed folder onto that folder and badges it', () => {
    const edges = byId(visibleEdges(SAMPLE, []));
    // index.ts -> src/lib/utils.ts lands on the collapsed `src` folder.
    expect(edges['f:index.ts->d:src']).toEqual({
      id: 'f:index.ts->d:src',
      source: 'f:index.ts',
      target: 'd:src',
      count: 1,
      aggregated: true,
    });
  });

  it('merges every import between two collapsed folders into one counted edge', () => {
    const edges = byId(visibleEdges(SAMPLE, []));
    // app/page.tsx -> src/lib/utils.ts and app/blog/page.tsx -> src/lib/deep/math.ts
    expect(edges['d:app->d:src']).toMatchObject({ count: 2, aggregated: true });
  });

  it('drops edges whose two ends fall in the same collapsed folder', () => {
    const edges = visibleEdges(SAMPLE, []);
    expect(edges.map((e) => e.id).sort()).toEqual([
      'd:app->d:src',
      'f:index.ts->d:app',
      'f:index.ts->d:src',
    ]);
  });

  it('maps into the outermost of nested collapsed folders', () => {
    const edges = byId(visibleEdges(SAMPLE, ['src']));
    // src/main.ts -> src/lib/utils.ts; src/lib/utils.ts -> src/lib/deep/math.ts is now internal.
    expect(edges['f:src/main.ts->d:src/lib']).toMatchObject({ count: 1, aggregated: true });
    expect(Object.keys(edges).some((k) => k.includes('deep'))).toBe(false);
  });

  it('keeps a single file-to-file import as a plain edge', () => {
    const all = ['src', 'src/lib', 'src/lib/deep', 'app', 'app/blog'];
    const edges = visibleEdges(SAMPLE, all);
    expect(edges).toHaveLength(SAMPLE.edges.length);
    expect(edges.every((e) => e.count === 1 && !e.aggregated)).toBe(true);
  });

  it('keeps the importer -> imported direction', () => {
    const edges = byId(visibleEdges(SAMPLE, ['src', 'src/lib', 'src/lib/deep']));
    expect(edges['f:src/lib/utils.ts->f:src/lib/deep/math.ts']).toMatchObject({
      source: 'f:src/lib/utils.ts',
      target: 'f:src/lib/deep/math.ts',
    });
  });

  it('keeps both directions apart when two folders import each other', () => {
    const graph = makeGraph(
      ['a/x.ts', 'b/y.ts'],
      [
        ['a/x.ts', 'b/y.ts'],
        ['b/y.ts', 'a/x.ts'],
      ],
    );
    const edges = byId(visibleEdges(graph, []));
    expect(Object.keys(edges).sort()).toEqual(['d:a->d:b', 'd:b->d:a']);
  });

  it('returns nothing for a graph without edges', () => {
    expect(visibleEdges(makeGraph(['a.ts', 'b.ts']), [])).toEqual([]);
  });
});
