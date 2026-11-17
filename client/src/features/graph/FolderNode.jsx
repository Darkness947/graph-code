import { memo } from 'react';
import { useWorkspaceStore } from '../../store/workspaceStore.js';
import { countOf } from '../repos/messages.js';
import Handles from './Handles.jsx';

const files = (n) => countOf(n, 'file', 'files');

/**
 * A folder on the canvas (spec 8.6 items 1 and 5). Collapsed, it is one node that stands for
 * everything inside it: name, file count and a chevron that expands it (double-click works
 * too). Expanded, it is a container sized around its children, with a chevron that collapses it.
 */
function FolderNode({ data }) {
  const toggleFolder = useWorkspaceStore((s) => s.toggleFolder);
  const toggle = (
    <button
      type="button"
      className="gc-chevron nodrag nopan"
      aria-label={`${data.expanded ? 'Collapse' : 'Expand'} folder ${data.path}`}
      aria-expanded={data.expanded}
      onClick={(event) => {
        event.stopPropagation();
        toggleFolder(data.path);
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
        <Handles />
        <div className="gc-tray-header">
          <i className="bi bi-folder2-open gc-folder-icon" aria-hidden="true" />
          <span className="gc-folder-name" title={data.path}>
            {data.name}
          </span>
          <span className="gc-folder-count">{files(data.fileCount)}</span>
          {toggle}
        </div>
      </div>
    );
  }

  return (
    <div className="gc-stack" title={data.path}>
      <Handles />
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
    </div>
  );
}

export default memo(FolderNode);
