import { beforeEach, describe, expect, it } from 'vitest';
import { makeGraph, SAMPLE } from '../../test/graphFixture.js';
import { computeVisibleNodes } from '../features/graph/visibility.js';
import { useWorkspaceStore } from './workspaceStore.js';

const state = () => useWorkspaceStore.getState();

describe('workspaceStore', () => {
  beforeEach(() => state().reset());

  it('loads a graph with every top-level folder collapsed', () => {
    state().toggleFolder('src');
    state().loadGraph(SAMPLE);
    expect(state().graph.nodesById.size).toBe(SAMPLE.nodes.length);
    expect(state().expandedFolders.size).toBe(0);
  });

  it('holds every field in spec 8.8', () => {
    expect(Object.keys(state())).toEqual(
      expect.arrayContaining([
        'graph',
        'expandedFolders',
        'hoveredNodeId',
        'selectedNodeId',
        'focus',
        'aiByNodeId',
        'search',
        'sidebarCollapsed',
        'codeDrawer',
      ]),
    );
  });

  it('toggles a folder with a new Set each time', () => {
    const before = state().expandedFolders;
    state().toggleFolder('src');
    expect(state().expandedFolders).not.toBe(before);
    expect([...state().expandedFolders]).toEqual(['src']);
    state().toggleFolder('src');
    expect(state().expandedFolders.size).toBe(0);
  });

  it('expands a nested folder together with the folders above it', () => {
    state().expandFolder('src/lib/deep');
    expect([...state().expandedFolders].sort()).toEqual(['src', 'src/lib', 'src/lib/deep']);
  });

  it('leaves the set alone when the folder is already open', () => {
    state().expandFolder('src');
    const before = state().expandedFolders;
    state().expandFolder('src');
    expect(state().expandedFolders).toBe(before);
  });

  it('tracks the hovered node', () => {
    state().setHovered('f:index.ts');
    expect(state().hoveredNodeId).toBe('f:index.ts');
    state().setHovered(null);
    expect(state().hoveredNodeId).toBeNull();
  });
});

describe('workspaceStore wrapper folders (decision D-05)', () => {
  it('opens wrapper folders in place on load', () => {
    useWorkspaceStore.getState().loadGraph(makeGraph(['src/a.ts', 'src/b.ts', 'src/c.ts', 'x.ts']));
    expect([...useWorkspaceStore.getState().expandedFolders]).toEqual(['src']);
  });

  const CLIENT_SERVER = [
    ...Array.from({ length: 12 }, (_, i) => `client/src/c${i}.ts`),
    'client/vite.config.ts',
    ...Array.from({ length: 10 }, (_, i) => `server/src/s${i}.ts`),
    'server/x.ts',
  ];

  it('keeps client and server collapsed on load', () => {
    state().loadGraph(makeGraph(CLIENT_SERVER));
    expect(state().expandedFolders.size).toBe(0);
  });

  it('opens the wrapper chain together with a folder, and collapses only that folder', () => {
    state().loadGraph(makeGraph(CLIENT_SERVER));
    state().toggleFolder('client');
    expect([...state().expandedFolders]).toEqual(['client', 'client/src']);
    state().toggleFolder('client');
    expect([...state().expandedFolders]).toEqual(['client/src']);
  });

  it('opens the wrapper chain below a folder it reveals', () => {
    state().loadGraph(makeGraph(CLIENT_SERVER));
    state().expandFolder('server');
    expect([...state().expandedFolders].sort()).toEqual(['server', 'server/src']);
  });

  it("draws client/src's children inside client after a collapse and re-expand", () => {
    state().loadGraph(makeGraph(CLIENT_SERVER));
    state().toggleFolder('client');
    state().toggleFolder('client');
    state().toggleFolder('client');
    const visible = computeVisibleNodes(state().graph, state().expandedFolders);
    expect(visible.find((v) => v.id === 'd:client/src')).toBeUndefined();
    expect(visible.find((v) => v.id === 'f:client/src/c0.ts')).toMatchObject({
      parentId: 'd:client',
    });
  });

  describe('focus, search and sidebar', () => {
    beforeEach(() => state().loadGraph(SAMPLE));

    it('selects a file, enters focus mode with its neighbourhood and opens its folders', () => {
      state().selectFile('f:src/lib/deep/math.ts');
      expect(state().selectedNodeId).toBe('f:src/lib/deep/math.ts');
      expect(state().focus.active).toBe(true);
      expect(state().focus.nodeIds[0]).toBe('f:src/lib/deep/math.ts');
      expect(state().focus.nodeIds).toContain('f:src/lib/utils.ts');
      expect(state().expandedFolders.has('src/lib/deep')).toBe(true);
      expect(state().expandedFolders.has('src')).toBe(true);
    });

    it('ignores folders and unknown ids', () => {
      state().selectFile('d:src');
      state().selectFile('nope');
      expect(state().selectedNodeId).toBeNull();
      expect(state().focus.active).toBe(false);
    });

    it('clears focus and selection', () => {
      state().selectFile('f:index.ts');
      state().clearFocus();
      expect(state().selectedNodeId).toBeNull();
      expect(state().focus).toEqual({ active: false, nodeIds: [] });
    });

    it('keeps search results in step with the query and clears them', () => {
      state().setSearchQuery('utils');
      expect(state().search.results.map((r) => r.path)).toEqual(['src/lib/utils.ts']);
      state().clearSearch();
      expect(state().search).toEqual({ query: '', results: [] });
    });

    it('toggles the sidebar', () => {
      state().toggleSidebar();
      expect(state().sidebarCollapsed).toBe(true);
      state().toggleSidebar();
      expect(state().sidebarCollapsed).toBe(false);
    });
  });
});
