import { describe, expect, it } from 'vitest';
import { makeGraph, SAMPLE } from '../../../test/graphFixture.js';
import { buildGraphIndex } from './graphIndex.js';
import {
  FILE_SIZES,
  FOLDER_HEADER,
  FOLDER_MIN,
  FOLDER_PAD,
  FOLDER_SIZE,
  layoutGraph,
} from './layout.js';

const layout = (graph, expanded = []) => layoutGraph(buildGraphIndex(graph), new Set(expanded));
const node = (result, id) => result.nodes.find((n) => n.id === id);

describe('layoutGraph', () => {
  it('lays out only the visible nodes', () => {
    const result = layout(SAMPLE);
    expect(result.nodes.map((n) => n.id)).toEqual(['d:app', 'd:src', 'f:index.ts']);
    expect(result.edges.map((e) => e.id).sort()).toEqual([
      'd:app->d:src',
      'f:index.ts->d:app',
      'f:index.ts->d:src',
    ]);
  });

  it('draws a collapsed folder as one node with its name and file count', () => {
    const src = node(layout(SAMPLE), 'd:src');
    expect(src).toMatchObject({ type: 'folder', ...FOLDER_SIZE });
    expect(src.data).toMatchObject({ name: 'src', fileCount: 3, expanded: false });
  });

  it('places importers above what they import (top to bottom)', () => {
    const result = layout(SAMPLE);
    expect(node(result, 'f:index.ts').position.y).toBeLessThan(node(result, 'd:app').position.y);
    expect(node(result, 'd:app').position.y).toBeLessThan(node(result, 'd:src').position.y);
  });

  it('sizes an expanded folder from its children and places them inside it', () => {
    const result = layout(SAMPLE, ['src']);
    const src = node(result, 'd:src');
    const kids = result.nodes.filter((n) => n.parentId === 'd:src');
    expect(kids.map((n) => n.id).sort()).toEqual(['d:src/lib', 'f:src/main.ts']);
    for (const kid of kids) {
      expect(kid.position.x).toBeGreaterThanOrEqual(FOLDER_PAD);
      expect(kid.position.y).toBeGreaterThanOrEqual(FOLDER_HEADER);
      expect(kid.position.x + kid.width).toBeLessThanOrEqual(src.width - FOLDER_PAD + 0.5);
      expect(kid.position.y + kid.height).toBeLessThanOrEqual(src.height - FOLDER_PAD + 0.5);
    }
    // main.ts imports something inside src/lib, so it sits above it.
    expect(node(result, 'f:src/main.ts').position.y).toBeLessThan(
      node(result, 'd:src/lib').position.y,
    );
  });

  it('gives an expanded folder at least 180 × 80', () => {
    const result = layout(makeGraph(['a/b/c.ts']), ['a', 'a/b']);
    const b = node(result, 'd:a/b');
    expect(b.width).toBeGreaterThanOrEqual(FOLDER_MIN.width);
    expect(b.height).toBeGreaterThanOrEqual(FOLDER_MIN.height);
  });

  it('wraps a folder with more than 8 direct children into a grid', () => {
    const files = Array.from({ length: 12 }, (_, i) => `many/f${i}.ts`);
    const result = layout(makeGraph(files), ['many']);
    const kids = result.nodes.filter((n) => n.parentId === 'd:many');
    const rows = new Set(kids.map((n) => n.position.y));
    const cols = new Set(kids.map((n) => n.position.x));
    expect(rows.size).toBeGreaterThan(1);
    expect(cols.size).toBeGreaterThan(1);
    expect(cols.size).toBeLessThan(12);
  });

  it('keeps a folder with 8 children connected by imports in a Dagre layout', () => {
    const files = Array.from({ length: 8 }, (_, i) => `chain/f${i}.ts`);
    const imports = files.slice(1).map((f, i) => [files[i], f]);
    const result = layout(makeGraph(files, imports), ['chain']);
    const ys = files.map((f) => node(result, `f:${f}`).position.y);
    expect([...ys].sort((a, b) => a - b)).toEqual(ys);
    expect(new Set(ys).size).toBe(8);
  });

  it('packs files with no edges in a grid instead of one long row', () => {
    const files = Array.from({ length: 20 }, (_, i) => `f${i}.ts`);
    const result = layout(makeGraph(files));
    expect(new Set(result.nodes.map((n) => n.position.y)).size).toBeGreaterThan(1);
  });

  it('nests positions relative to the parent folder, parents listed first', () => {
    const result = layout(SAMPLE, ['src', 'src/lib', 'src/lib/deep']);
    const order = result.nodes.map((n) => n.id);
    for (const n of result.nodes.filter((x) => x.parentId)) {
      expect(order.indexOf(n.parentId)).toBeLessThan(order.indexOf(n.id));
    }
    expect(node(result, 'f:src/lib/deep/math.ts')).toMatchObject({ parentId: 'd:src/lib/deep' });
  });

  it('gives central files a larger size and their tier', () => {
    const files = Array.from({ length: 40 }, (_, i) => `f${i}.ts`);
    // f0 is imported by everyone, f1..f3 by a few, the rest by nobody.
    const imports = [
      ...files.slice(1).map((f) => [f, 'f0.ts']),
      ...['f1.ts', 'f2.ts', 'f3.ts', 'f4.ts'].flatMap((t) =>
        files.slice(10, 13).map((f) => [f, t]),
      ),
    ];
    const result = layout(makeGraph(files, imports));
    expect(node(result, 'f:f0.ts')).toMatchObject({ ...FILE_SIZES[2], data: { tier: 2 } });
    expect(node(result, 'f:f1.ts')).toMatchObject({ ...FILE_SIZES[1], data: { tier: 1 } });
    expect(node(result, 'f:f20.ts')).toMatchObject({ ...FILE_SIZES[0], data: { tier: 0 } });
  });

  it('carries the file counters and parent hint', () => {
    const result = layout(SAMPLE, ['src', 'src/lib']);
    expect(node(result, 'f:src/lib/utils.ts').data).toMatchObject({
      name: 'utils.ts',
      hint: 'src/lib',
      fanIn: 3,
      fanOut: 1,
    });
  });

  it('carries the count and aggregation flag on edges', () => {
    const edge = layout(SAMPLE).edges.find((e) => e.id === 'd:app->d:src');
    expect(edge).toMatchObject({
      source: 'd:app',
      target: 'd:src',
      type: 'aggregate',
      data: { count: 2, aggregated: true, expandPath: 'src' },
    });
  });

  it('expands nothing from an edge whose target is a file', () => {
    const result = layout(SAMPLE, ['src', 'src/lib']);
    // app (collapsed) -> src/lib/utils.ts: aggregated because of the folder, but the target is a file.
    const edge = result.edges.find((e) => e.id === 'd:app->f:src/lib/utils.ts');
    expect(edge.data).toMatchObject({ aggregated: true, expandPath: null });
  });

  it('orders a wrapped grid so importers come before what they import', () => {
    const files = Array.from({ length: 10 }, (_, i) => `grid/f${i}.ts`);
    // f9 imports f0; everything else is unrelated.
    const result = layout(makeGraph(files, [['grid/f9.ts', 'grid/f0.ts']]), ['grid']);
    const order = result.nodes
      .filter((n) => n.parentId === 'd:grid')
      .sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x)
      .map((n) => n.data.name);
    expect(order[0]).toBe('f9.ts');
    expect(order.at(-1)).toBe('f0.ts');
  });

  it('routes an edge that skips a rank around the node in between', () => {
    // a -> b -> c and a -> c: the a -> c edge passes the rank of b.
    const graph = makeGraph(
      ['a.ts', 'b.ts', 'c.ts'],
      [
        ['a.ts', 'b.ts'],
        ['b.ts', 'c.ts'],
        ['a.ts', 'c.ts'],
      ],
    );
    const result = layout(graph);
    const long = result.edges.find((e) => e.id === 'f:a.ts->f:c.ts');
    const short = result.edges.find((e) => e.id === 'f:a.ts->f:b.ts');
    expect(short.data.route).toBeNull();
    const route = long.data.route;
    const a = node(result, 'f:a.ts');
    const c = node(result, 'f:c.ts');
    expect(route[0]).toEqual({ x: a.position.x + a.width / 2, y: a.position.y + a.height });
    expect(route.at(-1)).toEqual({ x: c.position.x + c.width / 2, y: c.position.y });
    // Beside b, not through it.
    const b = node(result, 'f:b.ts');
    const level = route.filter((p) => p.y > b.position.y && p.y < b.position.y + b.height);
    expect(level.length).toBeGreaterThan(0);
    for (const p of level) {
      expect(p.x < b.position.x || p.x > b.position.x + b.width).toBe(true);
    }
  });

  it('copes with an empty graph', () => {
    expect(layout(makeGraph([]))).toEqual({ nodes: [], edges: [] });
  });
});
