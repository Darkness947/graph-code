import { describe, expect, it } from 'vitest';
import { makeGraph, SAMPLE } from '../../../test/graphFixture.js';
import { buildGraphIndex } from './graphIndex.js';
import {
  buildVisibleAncestorMap,
  computeVisibleNodes,
  folderChain,
  wrapperFolders,
} from './visibility.js';

const index = buildGraphIndex(SAMPLE);
const ids = (list) => list.map((v) => v.id);

describe('buildGraphIndex', () => {
  it('lists children folders first, then by name, with the root under ""', () => {
    expect(index.childrenByPath.get('')).toEqual(['d:app', 'd:src', 'f:index.ts']);
    expect(index.childrenByPath.get('app')).toEqual([
      'd:app/blog',
      'f:app/layout.tsx',
      'f:app/page.tsx',
    ]);
    expect(index.edges).toBe(SAMPLE.edges);
  });
});

describe('computeVisibleNodes', () => {
  it('shows only the top level on load, with every top-level folder collapsed', () => {
    const visible = computeVisibleNodes(index, new Set());
    expect(ids(visible)).toEqual(['d:app', 'd:src', 'f:index.ts']);
    expect(visible.filter((v) => v.kind === 'folder').every((v) => !v.expanded)).toBe(true);
  });

  it('reveals the children of an expanded folder, parents first', () => {
    const visible = computeVisibleNodes(index, new Set(['src']));
    expect(ids(visible)).toEqual(['d:app', 'd:src', 'd:src/lib', 'f:src/main.ts', 'f:index.ts']);
    expect(visible.find((v) => v.id === 'd:src/lib')).toMatchObject({
      parentId: 'd:src',
      depth: 1,
      expanded: false,
    });
  });

  it('keeps a folder hidden while any folder above it is collapsed', () => {
    // src/lib is marked expanded, but src is collapsed, so nothing inside src shows.
    const visible = computeVisibleNodes(index, new Set(['src/lib']));
    expect(ids(visible)).toEqual(['d:app', 'd:src', 'f:index.ts']);
  });

  it('nests expanded folders to any depth', () => {
    const visible = computeVisibleNodes(index, new Set(['src', 'src/lib', 'src/lib/deep']));
    expect(visible.find((v) => v.id === 'f:src/lib/deep/math.ts')).toMatchObject({
      parentId: 'd:src/lib/deep',
      depth: 3,
    });
  });
});

describe('buildVisibleAncestorMap', () => {
  it('maps every file inside a collapsed top-level folder to that folder', () => {
    const map = buildVisibleAncestorMap(index, new Set());
    expect(map.get('f:src/lib/deep/math.ts')).toBe('d:src');
    expect(map.get('f:app/blog/page.tsx')).toBe('d:app');
    expect(map.get('f:index.ts')).toBe('f:index.ts');
  });

  it('maps files under nested collapsed folders to the outermost collapsed one', () => {
    // src is expanded; src/lib and src/lib/deep are both collapsed.
    const map = buildVisibleAncestorMap(index, new Set(['src']));
    expect(map.get('f:src/lib/utils.ts')).toBe('d:src/lib');
    expect(map.get('f:src/lib/deep/math.ts')).toBe('d:src/lib');
    expect(map.get('f:src/main.ts')).toBe('f:src/main.ts');
  });

  it('ignores an expanded folder below a collapsed one', () => {
    const map = buildVisibleAncestorMap(index, new Set(['src/lib']));
    expect(map.get('f:src/lib/deep/math.ts')).toBe('d:src');
  });

  it('maps a file to itself once every folder above it is expanded', () => {
    const map = buildVisibleAncestorMap(index, new Set(['src', 'src/lib', 'src/lib/deep']));
    expect(map.get('f:src/lib/deep/math.ts')).toBe('f:src/lib/deep/math.ts');
  });

  it('maps every file in the graph', () => {
    const map = buildVisibleAncestorMap(index, new Set());
    expect(map.size).toBe(SAMPLE.nodes.filter((n) => n.type === 'file').length);
  });
});

describe('folderChain', () => {
  it('lists a path and the folders above it, outermost first', () => {
    expect(folderChain('src/lib/deep')).toEqual(['src', 'src/lib', 'src/lib/deep']);
    expect(folderChain('src')).toEqual(['src']);
  });
});

describe('wrapperFolders (decision D-05)', () => {
  const index = (files) => buildGraphIndex(makeGraph(files));

  it('finds a top-level folder holding at least 60% of the files', () => {
    expect([
      ...wrapperFolders(index(['src/a.ts', 'src/b.ts', 'src/c.ts', 'x.ts', 'y.ts'])),
    ]).toEqual(['src']);
  });

  it('repeats the check inside it', () => {
    const files = [
      'packages/core/a.ts',
      'packages/core/b.ts',
      'packages/core/c.ts',
      'packages/ui/d.ts',
      'x.ts',
    ];
    expect([...wrapperFolders(index(files))]).toEqual(['packages', 'packages/core']);
  });

  it('finds none when no folder dominates', () => {
    expect(wrapperFolders(buildGraphIndex(SAMPLE)).size).toBe(0);
    expect(wrapperFolders(index(['src/a.ts', 'x.ts'])).size).toBe(0);
    expect(wrapperFolders(index([])).size).toBe(0);
  });

  it("shows an expanded wrapper's children at its level and hides the wrapper itself", () => {
    const idx = index(['src/a.ts', 'src/lib/b.ts', 'src/lib/c.ts', 'x.ts']);
    const visible = computeVisibleNodes(idx, new Set(['src']));
    expect(visible.map((v) => v.id)).toEqual(['d:src/lib', 'f:src/a.ts', 'f:x.ts']);
    expect(visible.every((v) => v.parentId === null && v.depth === 0)).toBe(true);
  });
});
