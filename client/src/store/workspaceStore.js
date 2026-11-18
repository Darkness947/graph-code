import { create } from 'zustand';
import { buildGraphIndex } from '../features/graph/graphIndex.js';
import { computeFocusSet } from '../features/graph/focus.js';
import { folderChain, wrapperChain } from '../features/graph/visibility.js';
import { searchFiles } from '../features/search/search.js';

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
   * except the wrapper chain from the root, which opens in place (decision D-05).
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

  /**
   * Selects a file and enters focus mode (spec 8.6 item 8): the file and its 1–2 hop neighbours
   * stay lit. The folders around the file open so it is drawn. Makes no API call.
   */
  selectFile: (id) => {
    const { graph } = get();
    const node = graph?.nodesById.get(id);
    if (node?.type !== 'file') return;
    const { expandedFolders } = get();
    const wanted = node.parentPath
      ? [...folderChain(node.parentPath), ...wrapperChain(graph, node.parentPath)]
      : [];
    set({
      selectedNodeId: id,
      focus: { active: true, nodeIds: computeFocusSet(graph, id) },
      ...(wanted.some((p) => !expandedFolders.has(p))
        ? { expandedFolders: new Set([...expandedFolders, ...wanted]) }
        : {}),
    });
  },

  /** Leaves focus mode and clears the selection. */
  clearFocus: () => {
    if (get().selectedNodeId === null && !get().focus.active) return;
    set({ selectedNodeId: null, focus: { active: false, nodeIds: [] } });
  },

  setSearchQuery: (query) => {
    const { graph } = get();
    set({ search: { query, results: graph ? searchFiles(graph, query) : [] } });
  },

  clearSearch: () => set({ search: { query: '', results: [] } }),

  toggleSidebar: () => set({ sidebarCollapsed: !get().sidebarCollapsed }),

  setHovered: (id) => {
    if (get().hoveredNodeId !== id) set({ hoveredNodeId: id });
  },

  reset: () => set(initialState()),
}));
