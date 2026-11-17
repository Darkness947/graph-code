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
import { CanvasActions } from './canvasActions.js';
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
  const toggleInStore = useWorkspaceStore((s) => s.toggleFolder);
  const expandInStore = useWorkspaceStore((s) => s.expandFolder);
  const setHovered = useWorkspaceStore((s) => s.setHovered);
  const flow = useReactFlow();
  const flowStore = useStoreApi();
  const keepInView = useRef(null);

  const layout = useMemo(() => {
    try {
      return { ...layoutGraph(graph, expandedFolders), failed: false };
    } catch {
      return { nodes: [], edges: [], failed: true };
    }
  }, [graph, expandedFolders]);

  const { nodes, moving } = useAnimatedNodes(layout.nodes);

  // Keep the folder that was just expanded or collapsed in view (item 6). It moves only as
  // far as needed, and zooms out only when the folder is larger than the screen.
  useEffect(() => {
    const id = keepInView.current;
    keepInView.current = null;
    const rect = id && absoluteRect(layout.nodes, id);
    if (!rect) return;
    const { width, height } = flowStore.getState();
    const { x, y, zoom } = flow.getViewport();
    const margin = 32;
    const left = rect.x * zoom + x;
    const top = rect.y * zoom + y;
    const inside =
      left >= margin &&
      top >= margin &&
      left + rect.width * zoom <= width - margin &&
      top + rect.height * zoom <= height - margin;
    if (inside) return;
    const fits =
      rect.width * zoom <= width - 2 * margin && rect.height * zoom <= height - 2 * margin;
    if (fits) {
      flow.setCenter(rect.x + rect.width / 2, rect.y + rect.height / 2, {
        zoom,
        duration: MOVE_MS,
      });
    } else {
      flow.fitBounds(rect, { padding: 0.08, duration: MOVE_MS });
    }
  }, [layout, flow, flowStore]);

  const actions = useMemo(
    () => ({
      toggleFolder: (path, nodeId) => {
        keepInView.current = nodeId;
        toggleInStore(path);
      },
    }),
    [toggleInStore],
  );

  const onNodeDoubleClick = useCallback(
    (_event, node) => {
      if (node.type !== 'folder' || node.data.expanded) return;
      keepInView.current = node.id;
      expandInStore(node.data.path);
    },
    [expandInStore],
  );

  const onEdgeClick = useCallback(
    (_event, edge) => {
      if (!edge.data.expandPath) return;
      keepInView.current = edge.target;
      expandInStore(edge.data.expandPath);
    },
    [expandInStore],
  );

  const onNodeMouseEnter = useCallback((_event, node) => setHovered(node.id), [setHovered]);
  const onNodeMouseLeave = useCallback(() => setHovered(null), [setHovered]);

  if (layout.failed) return <GraphFallbackList nodes={graph.nodesById.values()} />;

  return (
    <CanvasActions.Provider value={actions}>
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
    </CanvasActions.Provider>
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
