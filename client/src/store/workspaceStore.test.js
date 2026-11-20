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

    it('selects a folder, which ends focus mode', () => {
      state().selectFile('f:index.ts');
      state().selectFolder('d:src');
      expect(state().selectedNodeId).toBe('d:src');
      expect(state().focus).toEqual({ active: false, nodeIds: [] });
      state().selectFolder('f:index.ts');
      expect(state().selectedNodeId).toBe('d:src');
      state().clearFocus();
      expect(state().selectedNodeId).toBeNull();
    });

    it('opens, closes and resizes the code drawer within 20 to 70 percent', () => {
      expect(state().codeDrawer).toEqual({ open: false, heightPct: 40 });
      state().openCode();
      expect(state().codeDrawer.open).toBe(true);
      state().setCodeHeight(10);
      expect(state().codeDrawer.heightPct).toBe(20);
      state().setCodeHeight(90);
      expect(state().codeDrawer.heightPct).toBe(70);
      state().closeCode();
      expect(state().codeDrawer).toEqual({ open: false, heightPct: 70 });
    });

    it('toggles the sidebar', () => {
      state().toggleSidebar();
      expect(state().sidebarCollapsed).toBe(true);
      state().toggleSidebar();
      expect(state().sidebarCollapsed).toBe(false);
    });
  });
});

describe('workspaceStore AI analysis (spec 8.6 item 9, 8.8)', () => {
  beforeEach(() => state().reset());

  const RESULT = {
    noDependents: false,
    cached: false,
    summary: 's',
    risks: [
      { path: 'app/blog/page.tsx', level: 'high', reason: 'r' },
      { path: 'index.ts', level: 'low', reason: 'r' },
    ],
    removedCount: 0,
  };

  it('records loading, then success, and adds the risk files to the focus', () => {
    state().loadGraph(SAMPLE);
    state().selectFile('f:src/lib/deep/math.ts');
    state().startAnalysis('f:src/lib/deep/math.ts');
    expect(state().aiByNodeId['f:src/lib/deep/math.ts']).toEqual({
      status: 'loading',
      result: null,
      errorCode: null,
    });

    state().finishAnalysis('f:src/lib/deep/math.ts', RESULT, state().graph);
    expect(state().aiByNodeId['f:src/lib/deep/math.ts'].status).toBe('success');
    // index.ts is three hops away, so only the AI result brings it into the focus.
    expect(state().focus.nodeIds).toContain('f:index.ts');
    expect(state().focus.nodeIds).toContain('f:app/blog/page.tsx');
    // The collapsed folders holding risk files open, with the folders above them.
    expect(state().expandedFolders.has('app')).toBe(true);
    expect(state().expandedFolders.has('app/blog')).toBe(true);
  });

  it('keeps the result without changing the focus when another file is selected', () => {
    state().loadGraph(SAMPLE);
    state().selectFile('f:src/lib/deep/math.ts');
    state().startAnalysis('f:src/lib/deep/math.ts');
    state().selectFile('f:app/layout.tsx');
    const focus = state().focus;
    state().finishAnalysis('f:src/lib/deep/math.ts', RESULT, state().graph);
    expect(state().focus).toBe(focus);

    // Coming back to the analysed file shows its AI extension again.
    state().selectFile('f:src/lib/deep/math.ts');
    expect(state().focus.nodeIds).toContain('f:index.ts');
  });

  it('drops a response for a graph that has been replaced', () => {
    state().loadGraph(SAMPLE);
    const old = state().graph;
    state().startAnalysis('f:index.ts');
    state().loadGraph(SAMPLE);
    state().finishAnalysis('f:index.ts', RESULT, old);
    state().failAnalysis('f:index.ts', { code: 'AI_TIMEOUT' }, old);
    expect(state().aiByNodeId).toEqual({});
  });

  it('records a failure with its code, and the wait for RATE_LIMITED, leaving focus intact', () => {
    state().loadGraph(SAMPLE);
    state().selectFile('f:src/lib/utils.ts');
    const focus = state().focus;
    state().failAnalysis(
      'f:src/lib/utils.ts',
      { code: 'RATE_LIMITED', retryAfterSeconds: 12 },
      state().graph,
    );
    expect(state().aiByNodeId['f:src/lib/utils.ts']).toEqual({
      status: 'error',
      result: null,
      errorCode: 'RATE_LIMITED',
      retryAfterSeconds: 12,
    });
    expect(state().focus).toBe(focus);
    state().failAnalysis('f:src/lib/utils.ts', {}, state().graph);
    expect(state().aiByNodeId['f:src/lib/utils.ts'].errorCode).toBe('INTERNAL');
  });
});
