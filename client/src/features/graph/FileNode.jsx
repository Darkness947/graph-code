import { Handle, Position } from '@xyflow/react';
import { memo } from 'react';

/**
 * A file on the canvas (spec 8.6 item 7): its name with a parent-folder hint, and how many
 * files it imports and how many import it. Central files have a heavier border (`tier`).
 */
function FileNode({ data }) {
  return (
    <div className={`gc-file tier-${data.tier}`} title={data.path}>
      <Handle type="target" position={Position.Top} isConnectable={false} className="gc-handle" />
      <div className="gc-file-title">
        <span className="gc-file-name">{data.name}</span>
        {data.hint && <span className="gc-file-hint"> · {data.hint}</span>}
      </div>
      <div className="gc-file-counts">
        imports <b>{data.fanOut}</b> · used by <b>{data.fanIn}</b>
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

export default memo(FileNode);
