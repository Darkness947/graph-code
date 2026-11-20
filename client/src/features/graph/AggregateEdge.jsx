import { BaseEdge, EdgeLabelRenderer, getBezierPath } from '@xyflow/react';
import { memo } from 'react';
import { useWorkspaceStore } from '../../store/workspaceStore.js';
import { countOf } from '../repos/messages.js';

const reach = (a, b) => Math.hypot(b.x - a.x, b.y - a.y) ** 0.5;

/** The Bézier control point next to `p1` on the segment p1 -> p2 (centripetal, alpha 0.5). */
function control(p0, p1, p2) {
  const d1 = reach(p0, p1);
  const d2 = reach(p1, p2);
  if (d1 === 0 || d2 === 0) return p1;
  const k = 3 * d1 * (d1 + d2);
  const w = 2 * d1 * d1 + 3 * d1 * d2 + d2 * d2;
  return {
    x: (d1 * d1 * p2.x - d2 * d2 * p0.x + w * p1.x) / k,
    y: (d1 * d1 * p2.y - d2 * d2 * p0.y + w * p1.y) / k,
  };
}

/**
 * A smooth path through Dagre's route (so long edges bend around the nodes between their
 * ends), pinned to the handles React Flow reports. While nodes animate, the inner points
 * follow the ends proportionally.
 * @param {{ points: Array<{ x: number, y: number }>, label: number }} route from the layout
 * @returns {[string, number, number]} the SVG path and the label position (middle of segment `label`)
 */
export function routedPath({ points: route, label }, sourceX, sourceY, targetX, targetY) {
  const n = route.length - 1;
  const ds = { x: sourceX - route[0].x, y: sourceY - route[0].y };
  const dt = { x: targetX - route[n].x, y: targetY - route[n].y };
  const pts = route.map((p, i) => {
    const f = i / n;
    return { x: p.x + ds.x * (1 - f) + dt.x * f, y: p.y + ds.y * (1 - f) + dt.y * f };
  });
  // Centripetal Catmull-Rom through the points, as cubic Béziers: unlike the uniform form
  // it never loops or overshoots where points are close together (at tray ports).
  let d = `M ${pts[0].x},${pts[0].y}`;
  for (let i = 0; i < n; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    const c1 = control(p0, p1, p2);
    const c2 = control(p3, p2, p1);
    d += ` C ${c1.x},${c1.y} ${c2.x},${c2.y} ${p2.x},${p2.y}`;
  }
  const a = pts[label];
  const b = pts[label + 1];
  return [d, (a.x + b.x) / 2, (a.y + b.y) / 2];
}

/** Thicker for edges that stand for more imports, within 1.25–3 px. */
export const strokeFor = (count) => Math.min(3, 1.25 + Math.log2(count) * 0.5);

/**
 * An import edge, importer -> imported (spec 8.6 items 3 and 4). At rest it is drawn in
 * `--edge-rest`; when either end is hovered it rises to `--edge-active`. A detail edge (one
 * file-level edge inside a bundle, decision D-06) is drawn only on demand, always active. An
 * edge between an analysed file and one of its high-risk files is drawn in `--risk-high`. Hover is read from the
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
  const hovered = useWorkspaceStore(
    (s) => s.hoveredNodeId === source || s.hoveredNodeId === target,
  );
  // A detail edge is only drawn for the hovered or selected node, so it is always active.
  const active = hovered || data.detail === true;
  const expandFolder = useWorkspaceStore((s) => s.expandFolder);
  const [path, labelX, labelY] = data.route
    ? routedPath(data.route, sourceX, sourceY, targetX, targetY)
    : getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition });
  const state = [
    active && 'is-active',
    data.detail && 'is-detail',
    data.dim && 'is-dim',
    data.risk && `is-risk-${data.risk}`,
  ]
    .filter(Boolean)
    .map((c) => ` ${c}`)
    .join('');
  const imports = countOf(data.count, 'import', 'imports');

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
                onClick={() => expandFolder(data.expandPath)}
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
