import { useReactFlow } from '@xyflow/react';
import { memo, useEffect, useMemo, useRef } from 'react';
import { useWorkspaceStore } from '../../store/workspaceStore.js';
import { MOVE_MS } from '../graph/useAnimatedNodes.js';
import { countOf } from '../repos/messages.js';

/** Folder path -> node id, so a folder click can find its node on the canvas. */
function folderIds(graph) {
  const map = new Map();
  for (const node of graph.nodesById.values())
    if (node.type === 'folder') map.set(node.path, node.id);
  return map;
}

/**
 * One tree row. It subscribes only to what it shows (is it selected, is it open), so a selection
 * or an expand re-renders the rows that changed, not the whole tree.
 */
const Row = memo(function Row({ node, graph, depth, ids }) {
  const isFile = node.type === 'file';
  const isSelected = useWorkspaceStore((s) => isFile && s.selectedNodeId === node.id);
  const open = useWorkspaceStore((s) => !isFile && s.expandedFolders.has(node.path));
  const toggleFolder = useWorkspaceStore((s) => s.toggleFolder);
  const expandFolder = useWorkspaceStore((s) => s.expandFolder);
  const selectFile = useWorkspaceStore((s) => s.selectFile);
  const flow = useReactFlow();
  const ref = useRef(null);

  // The tree follows the canvas: the selected file scrolls into view.
  useEffect(() => {
    if (isSelected) ref.current?.scrollIntoView?.({ block: 'nearest' });
  }, [isSelected]);

  const indent = { paddingLeft: 8 + depth * 14 };

  if (isFile) {
    return (
      <li>
        <button
          ref={ref}
          type="button"
          className={`gc-tree-row gc-tree-file${isSelected ? ' is-selected' : ''}`}
          style={indent}
          title={node.path}
          aria-current={isSelected ? 'true' : undefined}
          onClick={() => selectFile(node.id)}
        >
          <i className="bi bi-file-earmark-code" aria-hidden="true" />
          <span className="gc-tree-name">{node.name}</span>
        </button>
      </li>
    );
  }

  // Opening a folder pans to it (the canvas keeps a folder it just opened in view); a folder that
  // is already open is panned to directly.
  const reveal = () => {
    if (!open) {
      expandFolder(node.path);
      return;
    }
    const drawn = flow.getInternalNode(ids.get(node.path));
    if (drawn) {
      const { x, y } = drawn.internals.positionAbsolute;
      const { width = 0, height = 0 } = drawn.measured ?? {};
      flow.fitBounds({ x, y, width, height }, { padding: 0.2, maxZoom: 1, duration: MOVE_MS });
    }
  };

  return (
    <li>
      <div className="gc-tree-row gc-tree-folder" style={indent}>
        <button
          type="button"
          className="gc-tree-chevron"
          aria-label={`${open ? 'Collapse' : 'Expand'} ${node.path} in the directory`}
          aria-expanded={open}
          onClick={() => toggleFolder(node.path)}
        >
          <i className={`bi ${open ? 'bi-chevron-down' : 'bi-chevron-right'}`} aria-hidden="true" />
        </button>
        <button type="button" className="gc-tree-label" title={node.path} onClick={reveal}>
          <span className="gc-tree-name">{node.name}</span>
          <span className="gc-tree-count">{node.metrics?.fileCount ?? 0}</span>
        </button>
      </div>
      {open && <Children graph={graph} path={node.path} depth={depth + 1} ids={ids} />}
    </li>
  );
});

function Children({ graph, path, depth, ids }) {
  return (
    <ul className="gc-tree-list">
      {(graph.childrenByPath.get(path) ?? []).map((id) => (
        <Row key={id} node={graph.nodesById.get(id)} graph={graph} depth={depth} ids={ids} />
      ))}
    </ul>
  );
}

/**
 * The directory sidebar (spec 8.6): folders first, alphabetical, each with its file count.
 * It reads the canvas's own state, so the two stay in step: the folders open here are the ones
 * expanded on the canvas, and the selected file is highlighted.
 */
export default function DirectorySidebar() {
  const graph = useWorkspaceStore((s) => s.graph);
  const collapsed = useWorkspaceStore((s) => s.sidebarCollapsed);
  const toggleSidebar = useWorkspaceStore((s) => s.toggleSidebar);
  const ids = useMemo(() => folderIds(graph), [graph]);
  const files = useMemo(
    () => [...graph.nodesById.values()].filter((n) => n.type === 'file').length,
    [graph],
  );

  return (
    <aside className={`gc-sidebar${collapsed ? ' is-rail' : ''}`} aria-label="Directory">
      <div className="gc-sidebar-head">
        {!collapsed && (
          <span>
            Files <span className="gc-tree-count">{countOf(files, 'file', 'files')}</span>
          </span>
        )}
        <button
          type="button"
          className="gc-sidebar-toggle"
          aria-label={collapsed ? 'Show directory' : 'Hide directory'}
          aria-expanded={!collapsed}
          onClick={toggleSidebar}
        >
          <i
            className={`bi ${collapsed ? 'bi-layout-sidebar' : 'bi-layout-sidebar-inset'}`}
            aria-hidden="true"
          />
        </button>
      </div>
      {!collapsed && (
        <nav className="gc-tree" aria-label="Files and folders">
          <Children graph={graph} path="" depth={0} ids={ids} />
        </nav>
      )}
    </aside>
  );
}
