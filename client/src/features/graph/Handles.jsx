import { Handle, Position } from '@xyflow/react';

/**
 * The hidden anchors every node needs: imports arrive at the top, and leave from the
 * bottom (top-to-bottom layout, importer above imported).
 */
export default function Handles() {
  return (
    <>
      <Handle type="target" position={Position.Top} isConnectable={false} className="gc-handle" />
      <Handle
        type="source"
        position={Position.Bottom}
        isConnectable={false}
        className="gc-handle"
      />
    </>
  );
}
