import { describe, expect, it } from 'vitest';
import { buildGraphModel } from '../../src/services/ingestion/graphModel.js';
import { encodePathLtree } from '../../src/services/ingestion/ltree.js';

const file = (path, language = path.slice(path.lastIndexOf('.') + 1)) => ({
  path,
  language,
  contentHash: 'h'.repeat(64),
  sizeBytes: 10,
  exports: ['x'],
});

/** Builds a model with empty defaults and predictable ids (`id-1`, `id-2`, …) unless given `deps`. */
function model(fileGraph, deps) {
  let n = 0;
  return buildGraphModel(
    { edges: [], unresolved: [], skipped: [], ...fileGraph },
    deps ?? { newId: () => `id-${++n}` },
  );
}

/** `path [type] metrics` per node, in model order. */
const summary = (m) => m.nodes.map((n) => `${n.path} [${n.nodeType}] ${JSON.stringify(n.metrics)}`);

describe('buildGraphModel', () => {
  it('creates every ancestor folder once, with a recursive fileCount, sorted by path', () => {
    const m = model({
      files: [file('src/a/b/c/deep.ts'), file('src/a/x.ts'), file('lib/y.js'), file('root.js')],
    });
    expect(summary(m)).toEqual([
      'lib [folder] {"fileCount":1}',
      'lib/y.js [file] {"fanIn":0,"fanOut":0}',
      'root.js [file] {"fanIn":0,"fanOut":0}',
      'src [folder] {"fileCount":2}',
      'src/a [folder] {"fileCount":2}',
      'src/a/b [folder] {"fileCount":1}',
      'src/a/b/c [folder] {"fileCount":1}',
      'src/a/b/c/deep.ts [file] {"fanIn":0,"fanOut":0}',
      'src/a/x.ts [file] {"fanIn":0,"fanOut":0}',
    ]);
  });

  it('never creates a node for the root folder', () => {
    const m = model({ files: [file('a.js')] });
    expect(m.nodes.map((n) => n.path)).toEqual(['a.js']);
  });

  it('computes fanIn and fanOut from the edges, including a cycle', () => {
    const m = model({
      files: [file('a.ts'), file('b.ts'), file('c.ts'), file('d.ts')],
      edges: [
        { from: 'a.ts', to: 'b.ts' },
        { from: 'a.ts', to: 'c.ts' },
        { from: 'b.ts', to: 'c.ts' },
        { from: 'c.ts', to: 'b.ts' },
      ],
    });
    expect(summary(m)).toEqual([
      'a.ts [file] {"fanIn":0,"fanOut":2}',
      'b.ts [file] {"fanIn":2,"fanOut":1}',
      'c.ts [file] {"fanIn":2,"fanOut":1}',
      'd.ts [file] {"fanIn":0,"fanOut":0}',
    ]);
  });

  it('maps edges and unresolved imports to node ids', () => {
    const m = model({
      files: [file('src/a.ts'), file('src/b.ts')],
      edges: [{ from: 'src/a.ts', to: 'src/b.ts' }],
      unresolved: [{ sourcePath: 'src/b.ts', specifier: './gone', reason: 'file_not_found' }],
    });
    const id = Object.fromEntries(m.nodes.map((n) => [n.path, n.id]));
    expect(m.edges).toEqual([{ source: id['src/a.ts'], target: id['src/b.ts'] }]);
    expect(m.unresolved).toEqual([
      { sourceNodeId: id['src/b.ts'], rawSpecifier: './gone', reason: 'file_not_found' },
    ]);
  });

  it('gives every node a distinct UUID by default', () => {
    const m = model({ files: [file('a/b.ts'), file('a/c.ts')] }, {});
    const ids = m.nodes.map((n) => n.id);
    expect(new Set(ids).size).toBe(3);
    for (const id of ids) expect(id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('fills the node columns for files and folders, with the spec 5.3 ltree', () => {
    const m = model({ files: [file('app/[id]/page.tsx')] });
    expect(m.nodes).toEqual([
      {
        id: 'id-1',
        path: 'app',
        pathLtree: 'r.app',
        name: 'app',
        nodeType: 'folder',
        language: null,
        contentHash: null,
        sizeBytes: null,
        exports: null,
        metrics: { fileCount: 1 },
      },
      {
        id: 'id-2',
        path: 'app/[id]',
        pathLtree: encodePathLtree('app/[id]'),
        name: '[id]',
        nodeType: 'folder',
        language: null,
        contentHash: null,
        sizeBytes: null,
        exports: null,
        metrics: { fileCount: 1 },
      },
      {
        id: 'id-3',
        path: 'app/[id]/page.tsx',
        pathLtree: encodePathLtree('app/[id]/page.tsx'),
        name: 'page.tsx',
        nodeType: 'file',
        language: 'tsx',
        contentHash: 'h'.repeat(64),
        sizeBytes: 10,
        exports: ['x'],
        metrics: { fanIn: 0, fanOut: 0 },
      },
    ]);
    expect(m.nodes[1].pathLtree).toMatch(/^r\.app\._id__[0-9a-f]{8}$/);
  });

  it('summarises languages and builds the job report', () => {
    const skipped = [
      { path: 'big.js', reason: 'too_large' },
      { path: 'bad.ts', reason: 'parse_error' },
    ];
    const m = model({
      files: [file('a.ts'), file('b.ts'), file('c.tsx'), file('d.js')],
      unresolved: [
        { sourcePath: 'a.ts', specifier: './x', reason: 'file_not_found' },
        { sourcePath: 'a.ts', specifier: 'dynamic import (line 1)', reason: 'dynamic_import' },
      ],
      skipped,
    });
    expect(m.languageSummary).toEqual({ ts: 2, tsx: 1, js: 1 });
    expect(m.report).toEqual({ skippedFiles: skipped, unresolvedCount: 2 });
  });
});
