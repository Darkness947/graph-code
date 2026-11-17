import { create } from 'zustand';
import { buildGraphIndex } from '../features/graph/graphIndex.js';
import { ancestorPaths } from '../features/graph/visibility.js';

/** Workspace state (spec 8.8). `expandedFolders` is replaced, never mutated, so selectors see changes. */
const initialState = () => ({
  graph: null,
  expandedFolders: new Set(),
  hoveredNodeId: null,
  selectedNodeId: null,
  focus: { active: false, nodeIds: [] },
  aiByNodeId: {},
  search: { query: '', results: [] },
  sidebarCollapsed: false,
  codeDrawer: { open: false, heightPct: 40 },
});

export const useWorkspaceStore = create((set, get) => ({
  ...initialState(),

  /** Loads a `Graph` from the API. Every top-level folder starts collapsed (spec 8.6 item 1). */
  loadGraph: (graph) => set({ ...initialState(), graph: buildGraphIndex(graph) }),

  /** Expands a collapsed folder or collapses an expanded one. */
  toggleFolder: (path) => {
    const next = new Set(get().expandedFolders);
    if (next.has(path)) next.delete(path);
    else next.add(path);
    set({ expandedFolders: next });
  },

  /** Expands a folder and every folder above it, so it is visible and open. */
  expandFolder: (path) => {
    const { expandedFolders } = get();
    const wanted = ancestorPaths(path, { includeSelf: true });
    if (wanted.every((p) => expandedFolders.has(p))) return;
    set({ expandedFolders: new Set([...expandedFolders, ...wanted]) });
  },

  setHovered: (id) => {
    if (get().hoveredNodeId !== id) set({ hoveredNodeId: id });
  },

  reset: () => set(initialState()),
}));
