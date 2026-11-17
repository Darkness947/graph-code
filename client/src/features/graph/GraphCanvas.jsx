import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  useStoreApi,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useWorkspaceStore } from '../../store/workspaceStore.js';
import AggregateEdge from './AggregateEdge.jsx';
import CanvasErrorBoundary from './CanvasErrorBoundary.jsx';
import FileNode from './FileNode.jsx';
import FolderNode from './FolderNode.jsx';
import GraphFallbackList from './GraphFallbackList.jsx';
import './graph.css';
import { layoutGraph } from './layout.js';
import { MOVE_MS, useAnimatedNodes } from './useAnimatedNodes.js';

const nodeTypes = { file: FileNode, folder: FolderNode };
const edgeTypes = { aggregate: AggregateEdge };
const FIT = { padding: 0.12, maxZoom: 1 };
const minimapClass = (n) =>
  n.type === 'file' ? 'gc-mm-file' : n.data.expanded ? 'gc-mm-tray' : 'gc-mm-folder';

/**
 * The folder whose expand or collapse the user just asked for: the deepest path that changed
 * between two sets of expanded folders (expanding a nested folder also opens the ones above it).
 */
export function changedFolder(before, after) {
  let pick = null;
  const consider = (path) => {
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
function absoluteRect(nodes, id) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
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

/**
 * Lays out the store's graph and draws it with React Flow (spec 8.6 items 1–7, 10 and 11).
 * Layout runs only when the graph or the expanded folders change; hover is read by each edge
 * from the store and never triggers it.
 */
function Canvas() {
  const graph = useWorkspaceStore((s) => s.graph);
  const expandedFolders = useWorkspaceStore((s) => s.expandedFolders);
  const expandFolder = useWorkspaceStore((s) => s.expandFolder);
  const setHovered = useWorkspaceStore((s) => s.setHovered);
  const flow = useReactFlow();
  const flowStore = useStoreApi();
  const shownFolders = useRef(expandedFolders);

  const layout = useMemo(() => {
    try {
      return { ...layoutGraph(graph, expandedFolders), failed: false };
    } catch {
      return { nodes: [], edges: [], failed: true };
    }
  }, [graph, expandedFolders]);

  const { nodes, moving } = useAnimatedNodes(layout.nodes);

  // Keep the folder that was just expanded or collapsed in view (item 6), whoever changed it.
  // The view moves only as far as needed, and zooms out only when the folder is larger than
  // the screen.
  useEffect(() => {
    const path = changedFolder(shownFolders.current, expandedFolders);
    shownFolders.current = expandedFolders;
    const folder =
      path !== null && layout.nodes.find((n) => n.type === 'folder' && n.data.path === path);
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
  }, [layout, expandedFolders, flow, flowStore]);

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
        edges={layout.edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        colorMode="dark"
        fitView
        fitViewOptions={FIT}
        minZoom={0.05}
        maxZoom={2}
        onlyRenderVisibleElements
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        zoomOnDoubleClick={false}
        onNodeDoubleClick={onNodeDoubleClick}
        onEdgeClick={onEdgeClick}
        onNodeMouseEnter={onNodeMouseEnter}
        onNodeMouseLeave={onNodeMouseLeave}
      >
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
        <Canvas />
      </ReactFlowProvider>
    </CanvasErrorBoundary>
  );
}
