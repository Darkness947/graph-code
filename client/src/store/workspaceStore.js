import { create } from 'zustand';
import { buildGraphIndex } from '../features/graph/graphIndex.js';
import { folderChain, wrapperChain } from '../features/graph/visibility.js';

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

  /**
   * Loads a `Graph` from the API. Every top-level folder starts collapsed (spec 8.6 item 1),
   * except top-level wrapper folders, which open in place (decision D-05).
   */
  loadGraph: (graph) => {
    const index = buildGraphIndex(graph);
    set({ ...initialState(), graph: index, expandedFolders: new Set(wrapperChain(index, '')) });
  },

  /**
   * Expands a collapsed folder or collapses an expanded one. Expanding also opens the wrapper
   * chain below it (decision D-05), so `client` shows `client/src`'s children directly.
   */
  toggleFolder: (path) => {
    const { graph, expandedFolders } = get();
    const next = new Set(expandedFolders);
    if (next.has(path)) next.delete(path);
    else for (const p of [path, ...(graph ? wrapperChain(graph, path) : [])]) next.add(p);
    set({ expandedFolders: next });
  },

  /** Expands a folder, every folder above it and the wrapper chain below it. */
  expandFolder: (path) => {
    const { graph, expandedFolders } = get();
    const wanted = [...folderChain(path), ...(graph ? wrapperChain(graph, path) : [])];
    if (wanted.every((p) => expandedFolders.has(p))) return;
    set({ expandedFolders: new Set([...expandedFolders, ...wanted]) });
  },

  setHovered: (id) => {
    if (get().hoveredNodeId !== id) set({ hoveredNodeId: id });
  },

  reset: () => set(initialState()),
}));
