import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  useStoreApi,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import SearchBar from '../search/SearchBar.jsx';
import DirectorySidebar from '../sidebar/DirectorySidebar.jsx';
import { useWorkspaceStore } from '../../store/workspaceStore.js';
import AggregateEdge from './AggregateEdge.jsx';
import CanvasErrorBoundary from './CanvasErrorBoundary.jsx';
import FileNode from './FileNode.jsx';
import FolderNode from './FolderNode.jsx';
import GraphFallbackList from './GraphFallbackList.jsx';
import './graph.css';
import { highlightedVisibleIds } from './focus.js';
import { layoutGraph } from './layout.js';
import { MOVE_MS, useAnimatedNodes } from './useAnimatedNodes.js';
import { buildVisibleAncestorMap } from './visibility.js';

const nodeTypes = { file: FileNode, folder: FolderNode };
const edgeTypes = { aggregate: AggregateEdge };
const FIT = { padding: 0.12, maxZoom: 1 };
const minimapClass = (n) =>
  n.type === 'file' ? 'gc-mm-file' : n.data.expanded ? 'gc-mm-tray' : 'gc-mm-folder';

/**
 * The folder whose expand or collapse the user just asked for: the deepest drawn path that
 * changed between two sets of expanded folders (expanding a nested folder also opens the ones
 * above it, and expanding a folder opens the wrapper chain below it, which is not drawn).
 * @param {Set<string>} before
 * @param {Set<string>} after
 * @param {(path: string) => boolean} [isDrawn] whether the folder has a node on the canvas
 */
export function changedFolder(before, after, isDrawn = () => true) {
  let pick = null;
  const consider = (path) => {
    if (!isDrawn(path)) return;
    if (pick === null || path.split('/').length > pick.split('/').length) pick = path;
  };
  for (const p of after) if (!before.has(p)) consider(p);
  for (const p of before) if (!after.has(p)) consider(p);
  return pick;
}

const VIEW_MARGIN = 32;

/**
 * How to keep a rectangle in view with the least movement: nothing when it is already on
 * screen, pan to it at the same zoom when it fits, zoom out to fit it only when it is larger
 * than the screen.
 * @param {{ x: number, y: number, width: number, height: number }} rect canvas coordinates
 * @param {{ x: number, y: number, zoom: number }} viewport
 * @param {{ width: number, height: number }} screen
 * @returns {null | 'center' | 'fit'}
 */
export function keepInViewMove(rect, { x, y, zoom }, screen) {
  const m = VIEW_MARGIN;
  const left = rect.x * zoom + x;
  const top = rect.y * zoom + y;
  const w = rect.width * zoom;
  const h = rect.height * zoom;
  if (left >= m && top >= m && left + w <= screen.width - m && top + h <= screen.height - m) {
    return null;
  }
  return w <= screen.width - 2 * m && h <= screen.height - 2 * m ? 'center' : 'fit';
}

/** A node's rectangle in canvas coordinates (layout positions are relative to the parent). */
function absoluteRect(nodes, id, byId = new Map(nodes.map((n) => [n.id, n]))) {
  const node = byId.get(id);
  if (!node) return null;
  let x = node.position.x;
  let y = node.position.y;
  for (let p = byId.get(node.parentId); p; p = byId.get(p.parentId)) {
    x += p.position.x;
    y += p.position.y;
  }
  return { x, y, width: node.width, height: node.height };
}

/** `make()` for `item`, computed once per item and kept in `cache`. */
function copyOnce(cache, item, make) {
  let out = cache.get(item);
  if (!out) {
    out = make();
    cache.set(item, out);
  }
  return out;
}

/** The smallest rectangle holding all of `rects`. */
function union(rects) {
  const box = rects.reduce(
    (b, r) => ({
      left: Math.min(b.left, r.x),
      top: Math.min(b.top, r.y),
      right: Math.max(b.right, r.x + r.width),
      bottom: Math.max(b.bottom, r.y + r.height),
    }),
    { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity },
  );
  return { x: box.left, y: box.top, width: box.right - box.left, height: box.bottom - box.top };
}

/**
 * Lays out the store's graph and draws it with React Flow (spec 8.6 items 1–7, 10 and 11).
 * Layout runs only when the graph or the expanded folders change; hover only filters which
 * detail edges are drawn (decision D-06) and never triggers it.
 */
function Canvas() {
  const graph = useWorkspaceStore((s) => s.graph);
  const expandedFolders = useWorkspaceStore((s) => s.expandedFolders);
  const expandFolder = useWorkspaceStore((s) => s.expandFolder);
  const focus = useWorkspaceStore((s) => s.focus);
  const selectFile = useWorkspaceStore((s) => s.selectFile);
  const selectFolder = useWorkspaceStore((s) => s.selectFolder);
  const clearFocus = useWorkspaceStore((s) => s.clearFocus);
  const setHovered = useWorkspaceStore((s) => s.setHovered);
  const flow = useReactFlow();
  const flowStore = useStoreApi();
  const shownFolders = useRef(expandedFolders);
  const fittedFocus = useRef(focus);

  const layout = useMemo(() => {
    try {
      return { ...layoutGraph(graph, expandedFolders), failed: false };
    } catch {
      return { nodes: [], edges: [], details: [], failed: true };
    }
  }, [graph, expandedFolders]);

  // At rest only the bundles are drawn; the file-level edges a bundle stands for appear for
  // the hovered or selected node (decision D-06). This filters a list; it never re-runs layout.
  const hoveredNodeId = useWorkspaceStore((s) => s.hoveredNodeId);
  const selectedNodeId = useWorkspaceStore((s) => s.selectedNodeId);
  const detailsByNode = useMemo(() => {
    const map = new Map();
    for (const e of layout.details) {
      for (const id of [e.source, e.target]) {
        if (!map.has(id)) map.set(id, []);
        map.get(id).push(e);
      }
    }
    return map;
  }, [layout]);
  const edges = useMemo(() => {
    const extra = new Set();
    for (const id of [hoveredNodeId, selectedNodeId]) {
      for (const e of detailsByNode.get(id) ?? []) extra.add(e);
    }
    return extra.size ? [...layout.edges, ...extra] : layout.edges;
  }, [layout, detailsByNode, hoveredNodeId, selectedNodeId]);

  const { nodes: drawn, moving, moveNode } = useAnimatedNodes(layout.nodes);

  // Focus mode (item 8): the focused neighbourhood stays at full opacity, everything else is
  // dimmed. This only adds classes to the drawn nodes and edges; it never re-runs layout.
  const lit = useMemo(() => {
    if (!focus.active) return null;
    const parentOf = new Map(layout.nodes.map((n) => [n.id, n.parentId ?? null]));
    return highlightedVisibleIds(
      focus.nodeIds,
      buildVisibleAncestorMap(graph, expandedFolders),
      parentOf,
    );
  }, [focus, layout, graph, expandedFolders]);
  // Decorated copies are cached per source object, so while nodes animate only the ones that
  // moved are copied again, and a hover does not copy every dimmed edge.
  const nodeCache = useMemo(() => new WeakMap(), [lit, selectedNodeId]); // eslint-disable-line react-hooks/exhaustive-deps
  const edgeCache = useMemo(() => new WeakMap(), [lit]); // eslint-disable-line react-hooks/exhaustive-deps
  const nodes = useMemo(
    () =>
      lit
        ? drawn.map((n) =>
            copyOnce(nodeCache, n, () => {
              const dim = lit.has(n.id) ? '' : 'is-dim';
              const selected = n.id === selectedNodeId ? 'is-selected' : '';
              return dim || selected ? { ...n, className: `${dim} ${selected}`.trim() } : n;
            }),
          )
        : drawn.map((n) =>
            n.id === selectedNodeId && n.type === 'folder'
              ? copyOnce(nodeCache, n, () => ({ ...n, className: 'is-selected' }))
              : n,
          ),
    [drawn, lit, selectedNodeId, nodeCache],
  );
  const shownEdges = useMemo(
    () =>
      lit
        ? edges.map((e) =>
            lit.has(e.source) && lit.has(e.target)
              ? e
              : copyOnce(edgeCache, e, () => ({ ...e, data: { ...e.data, dim: true } })),
          )
        : edges,
    [edges, lit, edgeCache],
  );

  // Dragging: React Flow reports each pointer move as a position change; the node moves in the
  // drawn nodes and its edges follow. Other changes (measured sizes) are ignored, because the
  // layout owns sizes.
  const onNodesChange = useCallback(
    (changes) => {
      for (const c of changes) if (c.type === 'position' && c.position) moveNode(c.id, c.position);
    },
    [moveNode],
  );

  // Keep the folder that was just expanded or collapsed in view (item 6), whoever changed it.
  // The view moves only as far as needed, and zooms out only when the folder is larger than
  // the screen. A change of focus (item 8) moves the view instead: onto the highlighted set,
  // or back to the whole graph when focus ends.
  useEffect(() => {
    const folderAt = (path) =>
      layout.nodes.find((n) => n.type === 'folder' && n.data.path === path);
    const path = changedFolder(shownFolders.current, expandedFolders, (p) => !!folderAt(p));
    shownFolders.current = expandedFolders;

    if (fittedFocus.current !== focus) {
      const wasActive = fittedFocus.current.active;
      fittedFocus.current = focus;
      if (focus.active && lit) {
        const byId = new Map(layout.nodes.map((n) => [n.id, n]));
        const rects = layout.nodes
          .filter((n) => lit.has(n.id) && !(n.type === 'folder' && n.data.expanded))
          .map((n) => absoluteRect(layout.nodes, n.id, byId));
        if (rects.length) {
          flow.fitBounds(union(rects), { padding: 0.2, maxZoom: 1, duration: MOVE_MS });
        }
        return;
      }
      if (wasActive) {
        flow.fitView({ ...FIT, duration: MOVE_MS });
        return;
      }
    }

    const folder = path !== null && folderAt(path);
    const rect = folder && absoluteRect(layout.nodes, folder.id);
    if (!rect) return;
    const { width, height } = flowStore.getState();
    const viewport = flow.getViewport();
    const move = keepInViewMove(rect, viewport, { width, height });
    if (move === 'center') {
      flow.setCenter(rect.x + rect.width / 2, rect.y + rect.height / 2, {
        zoom: viewport.zoom,
        duration: MOVE_MS,
      });
    } else if (move === 'fit') {
      flow.fitBounds(rect, { padding: 0.08, duration: MOVE_MS });
    }
  }, [layout, expandedFolders, focus, lit, flow, flowStore]);

  // Escape leaves focus mode. The search bar claims an Escape that clears a search.
  useEffect(() => {
    const onKey = (event) => {
      if (event.key === 'Escape' && !event.defaultPrevented) clearFocus();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [clearFocus]);

  const onNodeClick = useCallback(
    (_event, node) => {
      if (node.type === 'file') selectFile(node.id);
      else selectFolder(node.id);
    },
    [selectFile, selectFolder],
  );

  const onNodeDoubleClick = useCallback(
    (_event, node) => {
      if (node.type === 'folder' && !node.data.expanded) expandFolder(node.data.path);
    },
    [expandFolder],
  );

  const onEdgeClick = useCallback(
    (_event, edge) => {
      if (edge.data.expandPath) expandFolder(edge.data.expandPath);
    },
    [expandFolder],
  );

  const onNodeMouseEnter = useCallback((_event, node) => setHovered(node.id), [setHovered]);
  const onNodeMouseLeave = useCallback(() => setHovered(null), [setHovered]);

  if (layout.failed) return <GraphFallbackList nodes={graph.nodesById.values()} />;

  return (
    <div className={`gc-canvas${moving ? ' is-moving' : ''}`} data-testid="graph-canvas">
      <ReactFlow
        nodes={nodes}
        edges={shownEdges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        colorMode="dark"
        fitView
        fitViewOptions={FIT}
        minZoom={0.05}
        maxZoom={2}
        onlyRenderVisibleElements
        onNodesChange={onNodesChange}
        nodesDraggable
        nodeDragThreshold={4}
        nodesConnectable={false}
        elementsSelectable={false}
        zoomOnDoubleClick={false}
        onNodeClick={onNodeClick}
        onNodeDoubleClick={onNodeDoubleClick}
        onEdgeClick={onEdgeClick}
        onNodeMouseEnter={onNodeMouseEnter}
        onNodeMouseLeave={onNodeMouseLeave}
      >
        <Panel position="top-left" className="gc-overlay">
          <SearchBar />
          {focus.active && (
            <button type="button" className="gc-back-pill nodrag nopan" onClick={clearFocus}>
              ← Back to full graph
            </button>
          )}
        </Panel>
        <Background variant={BackgroundVariant.Dots} gap={22} size={1} />
        <Controls position="bottom-left" showInteractive={false} fitViewOptions={FIT} />
        <MiniMap
          position="bottom-right"
          pannable
          zoomable
          nodeClassName={minimapClass}
          nodeBorderRadius={4}
          style={{ width: 150, height: 100 }}
          ariaLabel="Graph overview"
        />
      </ReactFlow>
    </div>
  );
}

/** The workspace canvas. Expects the graph to be loaded into the workspace store. */
export default function GraphCanvas() {
  const graph = useWorkspaceStore((s) => s.graph);
  if (!graph) return null;
  return (
    <CanvasErrorBoundary fallback={<GraphFallbackList nodes={graph.nodesById.values()} />}>
      <ReactFlowProvider>
        <div className="gc-workspace">
          <DirectorySidebar />
          <Canvas />
        </div>
      </ReactFlowProvider>
    </CanvasErrorBoundary>
  );
}
