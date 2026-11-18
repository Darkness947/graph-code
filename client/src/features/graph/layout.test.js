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

// Files outside the folder under test, so that folder is not a wrapper (decision D-05).
const OTHERS = Array.from({ length: 12 }, (_, i) => `other${i}.ts`);
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
    // Children can be dragged only within their folder's tray.
    expect(kids.every((n) => n.extent === 'parent')).toBe(true);
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
    const result = layout(makeGraph(['a/b/c.ts', ...OTHERS]), ['a', 'a/b']);
    const b = node(result, 'd:a/b');
    expect(b.width).toBeGreaterThanOrEqual(FOLDER_MIN.width);
    expect(b.height).toBeGreaterThanOrEqual(FOLDER_MIN.height);
  });

  it('wraps a folder with more than 8 direct children into a grid', () => {
    const files = Array.from({ length: 12 }, (_, i) => `many/f${i}.ts`);
    const result = layout(makeGraph([...files, ...OTHERS]), ['many']);
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
    const result = layout(makeGraph([...files, ...OTHERS], imports), ['chain']);
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
    // At rest it is bundled as app -> src, which also expands nothing: src is open.
    const bundle = result.edges.find((e) => e.id === 'd:app->d:src');
    expect(bundle.data).toMatchObject({ aggregated: true, expandPath: null });
    const detail = result.details.find((e) => e.id === 'd:app->f:src/lib/utils.ts');
    expect(detail.data).toMatchObject({ aggregated: false, expandPath: null });
  });

  it('orders a wrapped grid so importers come before what they import', () => {
    const files = Array.from({ length: 10 }, (_, i) => `grid/f${i}.ts`);
    // f9 imports f0; everything else is unrelated.
    const result = layout(makeGraph([...files, ...OTHERS], [['grid/f9.ts', 'grid/f0.ts']]), [
      'grid',
    ]);
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
    const route = long.data.route.points;
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
    expect(layout(makeGraph([]))).toEqual({ nodes: [], edges: [], details: [] });
  });
});

describe('edge ports', () => {
  // `app/page.tsx` imports `lib/deep/math.ts`; both folders are expanded and siblings at the top.
  const graph = makeGraph(
    ['app/page.tsx', 'app/other.tsx', 'lib/deep/math.ts', 'lib/x.ts', 'z1.ts', 'z2.ts', 'z3.ts'],
    [['app/page.tsx', 'lib/deep/math.ts']],
  );
  const result = layoutGraph(buildGraphIndex(graph), new Set(['app', 'lib', 'lib/deep']));
  const abs = (id) => {
    let x = 0;
    let y = 0;
    for (let n = node(result, id); n; n = node(result, n.parentId)) {
      x += n.position.x;
      y += n.position.y;
    }
    return { x, y, ...node(result, id) };
  };

  it('leaves through the bottom of each tray and enters through the top of each tray', () => {
    const { points } = result.details.find((e) => e.id === 'f:app/page.tsx->f:lib/deep/math.ts')
      .data.route;
    const page = abs('f:app/page.tsx');
    const app = abs('d:app');
    const lib = abs('d:lib');
    const deep = abs('d:lib/deep');
    const math = abs('f:lib/deep/math.ts');
    expect(points[0]).toEqual({ x: page.x + page.width / 2, y: page.y + page.height });
    expect(points[1]).toEqual({ x: app.x + app.width / 2, y: app.y + app.height });
    expect(points.at(-3)).toEqual({ x: lib.x + lib.width / 2, y: lib.y });
    expect(points.at(-2)).toEqual({ x: deep.x + deep.width / 2, y: deep.y });
    expect(points.at(-1)).toEqual({ x: math.x + math.width / 2, y: math.y });
  });

  it('puts the count badge on the stretch between the two trays', () => {
    const { points, label } = result.details.find(
      (e) => e.id === 'f:app/page.tsx->f:lib/deep/math.ts',
    ).data.route;
    const app = abs('d:app');
    const lib = abs('d:lib');
    expect(points[label].y).toBeGreaterThanOrEqual(app.y + app.height);
    expect(points[label + 1].y).toBeLessThanOrEqual(lib.y);
  });
});

describe('wrapper folders (decision D-05)', () => {
  const graph = makeGraph(
    ['src/a.ts', 'src/b.ts', 'src/lib/c.ts', 'src/lib/d.ts', 'x.ts'],
    [['src/a.ts', 'src/lib/c.ts']],
  );

  it('draws an expanded wrapper without a tray, its children at the top level', () => {
    const result = layoutGraph(buildGraphIndex(graph), new Set(['src']));
    expect(node(result, 'd:src')).toBeUndefined();
    expect(node(result, 'f:src/a.ts').parentId).toBeUndefined();
    expect(node(result, 'f:src/a.ts').data.hint).toBe('src');
    expect(node(result, 'd:src/lib').parentId).toBeUndefined();
  });

  it('draws a collapsed wrapper as an ordinary collapsed folder', () => {
    const result = layoutGraph(buildGraphIndex(graph), new Set());
    expect(node(result, 'd:src').data).toMatchObject({ expanded: false, fileCount: 4 });
  });
});

describe('nested wrapper folders (decision D-05)', () => {
  const files = [
    ...Array.from({ length: 4 }, (_, i) => `client/src/c${i}.ts`),
    ...Array.from({ length: 8 }, (_, i) => `client/src/lib/l${i}.ts`),
    'client/vite.config.ts',
    ...Array.from({ length: 10 }, (_, i) => `server/src/s${i}.ts`),
  ];
  const graph = makeGraph(files, [['client/src/c0.ts', 'client/src/lib/l0.ts']]);

  it("draws client/src's children inside the client tray, with no src tray", () => {
    const result = layoutGraph(buildGraphIndex(graph), new Set(['client', 'client/src']));
    expect(node(result, 'd:client/src')).toBeUndefined();
    expect(node(result, 'f:client/src/c0.ts').parentId).toBe('d:client');
    expect(node(result, 'd:client/src/lib').parentId).toBe('d:client');
    expect(node(result, 'd:server').data).toMatchObject({ expanded: false });
  });
});

describe('edge ports inside a wrapped grid', () => {
  // `big` has 9 children, so it is a grid with no Dagre routes; two of them are trays.
  const files = [
    'big/a/x.ts',
    'big/b/y.ts',
    ...Array.from({ length: 7 }, (_, i) => `big/f${i}.ts`),
    ...Array.from({ length: 12 }, (_, i) => `o${i}.ts`),
  ];
  const graph = makeGraph(files, [['big/a/x.ts', 'big/b/y.ts']]);
  const result = layoutGraph(buildGraphIndex(graph), new Set(['big', 'big/a', 'big/b']));

  it('routes through the two ports alone, with the badge between them', () => {
    const { points, label } = result.details.find((e) => e.id === 'f:big/a/x.ts->f:big/b/y.ts').data
      .route;
    expect(points).toHaveLength(4);
    expect(label).toBe(1);
    expect(points.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true);
  });
});

describe('edge bundles (decision D-06)', () => {
  // Three files in the open `ctrl` folder import the collapsed `models` folder; `ctrl/a.ts`
  // also imports its sibling `ctrl/b.ts`.
  const graph = makeGraph(
    ['ctrl/a.ts', 'ctrl/b.ts', 'ctrl/c.ts', 'models/m.ts', 'models/n.ts', ...OTHERS],
    [
      ['ctrl/a.ts', 'models/m.ts'],
      ['ctrl/b.ts', 'models/m.ts'],
      ['ctrl/c.ts', 'models/n.ts'],
      ['ctrl/a.ts', 'ctrl/b.ts'],
    ],
  );

  it('draws one bundle from an open folder to its sibling, carrying every import', () => {
    const result = layout(graph, ['ctrl']);
    const bundle = result.edges.find((e) => e.id === 'd:ctrl->d:models');
    expect(bundle).toMatchObject({ source: 'd:ctrl', target: 'd:models' });
    expect(bundle.data).toMatchObject({ count: 3, aggregated: true, expandPath: 'models' });
    expect(bundle.data.detail).toBe(false);
    expect(
      result.edges.some((e) => e.source.startsWith('f:ctrl/') && e.target === 'd:models'),
    ).toBe(false);
  });

  it('keeps the file-level edges a bundle stands for as details, drawn active', () => {
    const result = layout(graph, ['ctrl']);
    expect(result.details.map((e) => e.id).sort()).toEqual([
      'f:ctrl/a.ts->d:models',
      'f:ctrl/b.ts->d:models',
      'f:ctrl/c.ts->d:models',
    ]);
    expect(result.details.every((e) => e.data.detail === true)).toBe(true);
  });

  it('draws an edge between two files in the same tray once, as itself', () => {
    const result = layout(graph, ['ctrl']);
    expect(result.edges.filter((e) => e.id === 'f:ctrl/a.ts->f:ctrl/b.ts')).toHaveLength(1);
    expect(result.details.some((e) => e.id === 'f:ctrl/a.ts->f:ctrl/b.ts')).toBe(false);
  });

  it('offers no expand on a bundle into a folder that is already open', () => {
    const result = layout(graph, ['ctrl', 'models']);
    const bundle = result.edges.find((e) => e.id === 'd:ctrl->d:models');
    expect(bundle.data).toMatchObject({ count: 3, expandPath: null });
    expect(bundle.className).toBeUndefined();
  });

  it('badges a bundle between two open folders only when it carries several imports', () => {
    const one = makeGraph(
      ['p/a.ts', 'p/x.ts', 'q/b.ts', 'q/y.ts', ...OTHERS],
      [['p/a.ts', 'q/b.ts']],
    );
    const bundle = layout(one, ['p', 'q']).edges.find((e) => e.id === 'd:p->d:q');
    expect(bundle.data).toMatchObject({ count: 1, aggregated: false, expandPath: null });
  });

  it('gives detail edges no badge and a finite route that starts at the file', () => {
    const nested = makeGraph(
      ['outer/inner/f.ts', 'outer/g.ts', 'models/m.ts', 'models/n.ts', ...OTHERS],
      [['outer/inner/f.ts', 'models/m.ts']],
    );
    const result = layout(nested, ['outer', 'outer/inner']);
    const detail = result.details.find((e) => e.id === 'f:outer/inner/f.ts->d:models');
    expect(detail.data).toMatchObject({ aggregated: false, expandPath: null, detail: true });
    const { points } = detail.data.route;
    expect(points.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true);
    const f = node(result, 'f:outer/inner/f.ts');
    const inner = node(result, 'd:outer/inner');
    const outer = node(result, 'd:outer');
    expect(points[0]).toEqual({
      x: outer.position.x + inner.position.x + f.position.x + f.width / 2,
      y: outer.position.y + inner.position.y + f.position.y + f.height,
    });
  });
});
