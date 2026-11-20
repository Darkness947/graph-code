import { create } from 'zustand';
import { aiHighlight } from '../features/ai/aiHighlight.js';
import { buildGraphIndex } from '../features/graph/graphIndex.js';
import { computeFocusSet } from '../features/graph/focus.js';
import { folderChain, wrapperChain } from '../features/graph/visibility.js';
import { searchFiles } from '../features/search/search.js';

export const MIN_DRAWER_PCT = 20;
export const MAX_DRAWER_PCT = 70;
const clampDrawerHeight = (pct) =>
  Math.min(MAX_DRAWER_PCT, Math.max(MIN_DRAWER_PCT, Number.isFinite(pct) ? pct : MIN_DRAWER_PCT));

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

/** The folders that must be open for a file in `folder` to be drawn (decision D-05 included). */
const foldersToShow = (graph, folder) =>
  folder ? [...folderChain(folder), ...wrapperChain(graph, folder)] : [];

/**
 * Focus mode for a file (spec 8.6 item 8), extended by its AI result when it has one (item 9):
 * the risk files join the highlighted set and their folders open.
 */
function focusOn(graph, aiByNodeId, expandedFolders, id) {
  const node = graph.nodesById.get(id);
  const entry = aiByNodeId[id];
  const ai = aiHighlight(graph, entry?.status === 'success' ? entry.result : null);
  const nodeIds = computeFocusSet(graph, id);
  const lit = new Set(nodeIds);
  for (const riskId of ai.levels.keys()) if (!lit.has(riskId)) nodeIds.push(riskId);
  const wanted = [node.parentPath, ...ai.folders].flatMap((f) => foldersToShow(graph, f));
  return {
    focus: { active: true, nodeIds },
    ...(wanted.some((p) => !expandedFolders.has(p))
      ? { expandedFolders: new Set([...expandedFolders, ...wanted]) }
      : {}),
  };
}

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
   * stay lit. The folders around the file open so it is drawn. Makes no API call. A file that
   * already has an AI result shows it again (item 9).
   */
  selectFile: (id) => {
    const { graph, aiByNodeId, expandedFolders } = get();
    if (graph?.nodesById.get(id)?.type !== 'file') return;
    set({ selectedNodeId: id, ...focusOn(graph, aiByNodeId, expandedFolders, id) });
  },

  /** Selects a folder (spec 8.6 "Folder selected"). Focus mode is for files, so it ends. */
  selectFolder: (id) => {
    if (get().graph?.nodesById.get(id)?.type !== 'folder') return;
    set({ selectedNodeId: id, focus: { active: false, nodeIds: [] } });
  },

  openCode: () => {
    if (!get().codeDrawer.open) set({ codeDrawer: { ...get().codeDrawer, open: true } });
  },

  closeCode: () => {
    if (get().codeDrawer.open) set({ codeDrawer: { ...get().codeDrawer, open: false } });
  },

  /** Resizes the code drawer, between 20% and 70% of the workspace height. */
  setCodeHeight: (pct) =>
    set({ codeDrawer: { ...get().codeDrawer, heightPct: clampDrawerHeight(pct) } }),

  /** Leaves focus mode and clears the selection. */
  clearFocus: () => {
    if (get().selectedNodeId === null && !get().focus.active) return;
    set({ selectedNodeId: null, focus: { active: false, nodeIds: [] } });
  },

  /** Marks an analysis of file `id` as waiting for the server (spec 8.8 `aiByNodeId`). */
  startAnalysis: (id) =>
    set({
      aiByNodeId: { ...get().aiByNodeId, [id]: { status: 'loading', result: null, errorCode: null } },
    }),

  /**
   * Stores an `AnalysisResult` for file `id`. When the file is still selected, its risk files
   * join the focus (spec 8.6 item 9). A result for a graph that has since been replaced (another
   * repository, or a reload) is dropped.
   * @param {object} graph the `graph` the request was made for
   */
  finishAnalysis: (id, result, graph) => {
    const state = get();
    if (state.graph !== graph) return;
    const aiByNodeId = { ...state.aiByNodeId, [id]: { status: 'success', result, errorCode: null } };
    set({
      aiByNodeId,
      ...(state.selectedNodeId === id
        ? focusOn(graph, aiByNodeId, state.expandedFolders, id)
        : {}),
    });
  },

  /**
   * Records a failed analysis. `retryAfterSeconds` is kept for the `RATE_LIMITED` message.
   * The structural focus is left as it was.
   * @param {{ code?: string, retryAfterSeconds?: number }} error
   * @param {object} graph the `graph` the request was made for
   */
  failAnalysis: (id, error, graph) => {
    if (get().graph !== graph) return;
    const entry = { status: 'error', result: null, errorCode: error?.code ?? 'INTERNAL' };
    if (error?.retryAfterSeconds != null) entry.retryAfterSeconds = error.retryAfterSeconds;
    set({ aiByNodeId: { ...get().aiByNodeId, [id]: entry } });
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
