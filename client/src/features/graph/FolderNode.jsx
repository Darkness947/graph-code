import { Handle, Position } from '@xyflow/react';
import { memo } from 'react';
import { useCanvasActions } from './canvasActions.js';

const files = (n) => `${n} ${n === 1 ? 'file' : 'files'}`;

/**
 * A folder on the canvas (spec 8.6 items 1 and 5). Collapsed, it is one node that stands for
 * everything inside it: name, file count and a chevron that expands it (double-click works
 * too). Expanded, it is a container sized around its children, with a chevron that collapses it.
 */
function FolderNode({ id, data }) {
  const { toggleFolder } = useCanvasActions();
  const toggle = (
    <button
      type="button"
      className="gc-chevron nodrag nopan"
      aria-label={`${data.expanded ? 'Collapse' : 'Expand'} folder ${data.path}`}
      aria-expanded={data.expanded}
      onClick={(event) => {
        event.stopPropagation();
        toggleFolder(data.path, id);
      }}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      <i
        className={`bi ${data.expanded ? 'bi-chevron-up' : 'bi-chevron-down'}`}
        aria-hidden="true"
      />
    </button>
  );

  if (data.expanded) {
    return (
      <div className={`gc-tray depth-${data.depth % 2}`}>
        <Handle type="target" position={Position.Top} isConnectable={false} className="gc-handle" />
        <div className="gc-tray-header">
          <i className="bi bi-folder2-open gc-folder-icon" aria-hidden="true" />
          <span className="gc-folder-name" title={data.path}>
            {data.name}
          </span>
          <span className="gc-folder-count">{files(data.fileCount)}</span>
          {toggle}
        </div>
        <Handle
          type="source"
          position={Position.Bottom}
          isConnectable={false}
          className="gc-handle"
        />
      </div>
    );
  }

  return (
    <div className="gc-stack" title={data.path}>
      <Handle type="target" position={Position.Top} isConnectable={false} className="gc-handle" />
      <div className="gc-stack-body">
        <i className="bi bi-folder2 gc-folder-icon" aria-hidden="true" />
        <div className="gc-stack-text">
          <span className="gc-folder-name">{data.name}</span>
          <span className="gc-folder-count">
            {files(data.fileCount)}
            {data.hint && <span className="gc-file-hint"> · {data.hint}</span>}
          </span>
        </div>
        {toggle}
      </div>
      <Handle
        type="source"
        position={Position.Bottom}
        isConnectable={false}
        className="gc-handle"
      />
    </div>
  );
}

export default memo(FolderNode);
