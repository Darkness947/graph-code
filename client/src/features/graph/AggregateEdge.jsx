import { BaseEdge, EdgeLabelRenderer, getBezierPath } from '@xyflow/react';
import { memo } from 'react';
import { useWorkspaceStore } from '../../store/workspaceStore.js';
import { useCanvasActions } from './canvasActions.js';

/** Thicker for edges that stand for more imports, within 1.25–3 px. */
export const strokeFor = (count) => Math.min(3, 1.25 + Math.log2(count) * 0.5);

/**
 * An import edge, importer -> imported (spec 8.6 items 3 and 4). At rest it is drawn in
 * `--edge-rest`; when either end is hovered it rises to `--edge-active`. Hover is read from the
 * store per edge, so hovering never re-runs layout. An aggregated edge carries a count badge;
 * clicking it expands the folder at its target end.
 */
function AggregateEdge({
  id,
  source,
  target,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
}) {
  const active = useWorkspaceStore((s) => s.hoveredNodeId === source || s.hoveredNodeId === target);
  const { toggleFolder } = useCanvasActions();
  const [path, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });
  const state = active ? ' is-active' : '';
  const imports = `${data.count} ${data.count === 1 ? 'import' : 'imports'}`;

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        className={`gc-edge${state}`}
        style={{ strokeWidth: strokeFor(data.count) }}
        interactionWidth={14}
      />
      <path
        className={`gc-edge-arrow${state}`}
        d={`M ${targetX - 4.5} ${targetY - 8} L ${targetX} ${targetY - 1} L ${targetX + 4.5} ${targetY - 8} Z`}
      />
      {data.aggregated && (
        <EdgeLabelRenderer>
          <div
            className={`gc-edge-badge nodrag nopan${state}`}
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
          >
            {data.expandPath ? (
              <button
                type="button"
                aria-label={`${imports}. Expand folder ${data.expandPath}`}
                onClick={() => toggleFolder(data.expandPath, target)}
              >
                {data.count}
              </button>
            ) : (
              <span aria-label={imports}>{data.count}</span>
            )}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

export default memo(AggregateEdge);
