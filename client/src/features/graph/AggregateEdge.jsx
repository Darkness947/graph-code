import { BaseEdge, EdgeLabelRenderer, getBezierPath } from '@xyflow/react';
import { memo } from 'react';
import { useWorkspaceStore } from '../../store/workspaceStore.js';
import { useCanvasActions } from './canvasActions.js';

/**
 * A smooth path through Dagre's route (so long edges bend around the nodes between their
 * ends), pinned to the handles React Flow reports. While nodes animate, the inner points
 * follow the ends proportionally.
 * @returns {[string, number, number]} the SVG path and the label position
 */
export function routedPath(route, sourceX, sourceY, targetX, targetY) {
  const n = route.length - 1;
  const ds = { x: sourceX - route[0].x, y: sourceY - route[0].y };
  const dt = { x: targetX - route[n].x, y: targetY - route[n].y };
  const pts = route.map((p, i) => {
    const f = i / n;
    return { x: p.x + ds.x * (1 - f) + dt.x * f, y: p.y + ds.y * (1 - f) + dt.y * f };
  });
  // Catmull-Rom through the points, as cubic Béziers.
  let d = `M ${pts[0].x},${pts[0].y}`;
  for (let i = 0; i < n; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    const c1 = { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 };
    const c2 = { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 };
    d += ` C ${c1.x},${c1.y} ${c2.x},${c2.y} ${p2.x},${p2.y}`;
  }
  const mid = pts[Math.floor(n / 2)];
  const next = pts[Math.floor(n / 2) + 1];
  return [d, (mid.x + next.x) / 2, (mid.y + next.y) / 2];
}

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
  const [path, labelX, labelY] = data.route
    ? routedPath(data.route, sourceX, sourceY, targetX, targetY)
    : getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition });
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
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              // Above the tray the edge runs in, below the nodes inside it.
              zIndex: data.depth + 1,
            }}
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
