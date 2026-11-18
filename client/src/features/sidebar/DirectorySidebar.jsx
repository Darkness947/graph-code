import { useReactFlow } from '@xyflow/react';
import { useEffect, useMemo, useRef } from 'react';
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

function Row({ id, depth, ids }) {
  const graph = useWorkspaceStore((s) => s.graph);
  const expanded = useWorkspaceStore((s) => s.expandedFolders);
  const selected = useWorkspaceStore((s) => s.selectedNodeId);
  const toggleFolder = useWorkspaceStore((s) => s.toggleFolder);
  const expandFolder = useWorkspaceStore((s) => s.expandFolder);
  const selectFile = useWorkspaceStore((s) => s.selectFile);
  const flow = useReactFlow();
  const ref = useRef(null);
  const node = graph.nodesById.get(id);
  const isSelected = node.type === 'file' && selected === id;

  // The tree follows the canvas: the selected file scrolls into view.
  useEffect(() => {
    if (isSelected) ref.current?.scrollIntoView?.({ block: 'nearest' });
  }, [isSelected]);

  const indent = { paddingLeft: 8 + depth * 14 };

  if (node.type === 'file') {
    return (
      <li>
        <button
          ref={ref}
          type="button"
          className={`gc-tree-row gc-tree-file${isSelected ? ' is-selected' : ''}`}
          style={indent}
          title={node.path}
          aria-current={isSelected ? 'true' : undefined}
          onClick={() => selectFile(id)}
        >
          <i className="bi bi-file-earmark-code" aria-hidden="true" />
          <span className="gc-tree-name">{node.name}</span>
        </button>
      </li>
    );
  }

  const open = expanded.has(node.path);
  // Opening a folder pans to it (the canvas keeps a folder it just opened in view); a folder that
  // is already open is panned to directly.
  const reveal = () => {
    if (open) {
      const drawn = flow.getInternalNode(ids.get(node.path));
      if (drawn) {
        const { x, y } = drawn.internals.positionAbsolute;
        const { width = 0, height = 0 } = drawn.measured ?? {};
        flow.fitBounds({ x, y, width, height }, { padding: 0.2, maxZoom: 1, duration: MOVE_MS });
      }
    } else {
      expandFolder(node.path);
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
      {open && <Children path={node.path} depth={depth + 1} ids={ids} />}
    </li>
  );
}

function Children({ path, depth, ids }) {
  const graph = useWorkspaceStore((s) => s.graph);
  return (
    <ul className="gc-tree-list">
      {(graph.childrenByPath.get(path) ?? []).map((id) => (
        <Row key={id} id={id} depth={depth} ids={ids} />
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

  if (collapsed) {
    return (
      <aside className="gc-sidebar is-rail" aria-label="Directory">
        <button
          type="button"
          className="gc-sidebar-toggle"
          aria-label="Show directory"
          aria-expanded={false}
          onClick={toggleSidebar}
        >
          <i className="bi bi-layout-sidebar" aria-hidden="true" />
        </button>
      </aside>
    );
  }

  const files = [...graph.nodesById.values()].filter((n) => n.type === 'file').length;
  return (
    <aside className="gc-sidebar" aria-label="Directory">
      <div className="gc-sidebar-head">
        <span>
          Files <span className="gc-tree-count">{countOf(files, 'file', 'files')}</span>
        </span>
        <button
          type="button"
          className="gc-sidebar-toggle"
          aria-label="Hide directory"
          aria-expanded
          onClick={toggleSidebar}
        >
          <i className="bi bi-layout-sidebar-inset" aria-hidden="true" />
        </button>
      </div>
      <nav className="gc-tree" aria-label="Files and folders">
        <Children path="" depth={0} ids={ids} />
      </nav>
    </aside>
  );
}
