import { beforeEach, describe, expect, it } from 'vitest';
import { SAMPLE } from '../../test/graphFixture.js';
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
