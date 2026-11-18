import dagre from '@dagrejs/dagre';
import { aggregateEdges } from './aggregation.js';
import { centralityThresholds, centralityTier } from './centrality.js';
import { buildVisibleAncestorMap, computeVisibleNodes } from './visibility.js';

/**
 * Lays out the visible part of the graph for React Flow (spec 8.6 items 5 and 10).
 *
 * Layout is bottom-up. Each expanded folder lays out its direct children first, then takes
 * the size of what it holds (at least 180 × 80). Inside a container:
 * - children joined by edges are placed by Dagre, top to bottom, importer above imported;
 * - children with no edge inside the container are packed in a grid below them;
 * - a folder with more than 8 direct children is laid out as one wrapped grid.
 * The top level is always laid out the same way, with Dagre for everything connected.
 * Only visible nodes are ever laid out.
 */

/** File size per centrality tier: ordinary, top 10%, top 3%. */
export const FILE_SIZES = [
  { width: 216, height: 66 },
  { width: 236, height: 72 },
  { width: 256, height: 78 },
];
export const FOLDER_SIZE = { width: 216, height: 66 };
export const FOLDER_MIN = { width: 180, height: 80 };
export const FOLDER_HEADER = 44;
export const FOLDER_PAD = 24;
export const WRAP_AFTER = 8;

const GAP = 24;
const SPACING = {
  top: { nodesep: 56, ranksep: 96 },
  folder: { nodesep: 32, ranksep: 64 },
};

/**
 * @param {{ nodesById: Map<string, any>, childrenByPath: Map<string, string[]>, edges: object[] }} index
 * @param {Set<string>} expandedFolders folder paths
 * @returns {{ nodes: object[], edges: object[], details: object[] }} React Flow nodes (parents
 *   first; child positions relative to their parent); `edges`, the bundles drawn at rest, one
 *   per pair of siblings joined by imports (decision D-06); and `details`, the file-level edges
 *   a bundle stands for, drawn only for the hovered or selected node
 */
export function layoutGraph(index, expandedFolders) {
  const visible = computeVisibleNodes(index, expandedFolders);
  const ancestors = buildVisibleAncestorMap(index, expandedFolders);
  const visibleEdges = aggregateEdges(index.edges, ancestors, index.nodesById);
  const thresholds = thresholdsFor(index);

  const visById = new Map(visible.map((v) => [v.id, v]));
  const kidsOf = new Map([[null, []]]);
  for (const v of visible) {
    if (v.kind === 'folder' && v.expanded) kidsOf.set(v.id, []);
    kidsOf.get(v.parentId).push(v.id);
  }

  const size = new Map();
  const tier = new Map();
  const position = new Map();
  /** Dagre's edge routes per container, in that container's content frame. */
  const routesIn = new Map();

  for (const v of visible) {
    if (v.kind === 'file') {
      const t = centralityTier(index.nodesById.get(v.id).metrics?.fanIn ?? 0, thresholds);
      tier.set(v.id, t);
      size.set(v.id, FILE_SIZES[t]);
    } else if (!v.expanded) {
      size.set(v.id, FOLDER_SIZE);
    }
  }

  const chain = (id) => {
    const out = [id];
    for (let p = visById.get(id).parentId; p != null; p = visById.get(p).parentId) out.push(p);
    out.push(null);
    return out;
  };
  /**
   * Where an edge's ends meet: the innermost container holding both, and the nodes from each
   * end up to (not including) that container. The last of each side are siblings in it.
   */
  const meetOf = (edge) => {
    const up = chain(edge.source);
    const down = chain(edge.target);
    const at = new Map(down.map((id, i) => [id, i]));
    const i = up.findIndex((id, k) => k > 0 && at.has(id));
    const container = up[i];
    return { container, sourceSide: up.slice(0, i), targetSide: down.slice(0, at.get(container)) };
  };

  // Bundles (decision D-06): at rest every edge is drawn between the two siblings where its
  // ends meet, merged per pair. These are exactly the links Dagre lays out in each container.
  const bundles = new Map();
  const details = [];
  for (const edge of visibleEdges) {
    const meet = meetOf(edge);
    const source = meet.sourceSide.at(-1);
    const target = meet.targetSide.at(-1);
    const key = `${source}->${target}`;
    const found = bundles.get(key);
    if (found) found.count += edge.count;
    else
      bundles.set(key, { id: key, source, target, count: edge.count, container: meet.container });
    if (source !== edge.source || target !== edge.target) details.push({ edge, meet });
  }
  const linksIn = new Map();
  for (const b of bundles.values()) {
    if (!linksIn.has(b.container)) linksIn.set(b.container, new Set());
    linksIn.get(b.container).add(`${b.source}\n${b.target}`);
  }

  /** Lays out a container's children; returns the size of the content. */
  const layoutContainer = (containerId) => {
    const kids = kidsOf.get(containerId);
    for (const id of kids) {
      if (!size.has(id)) {
        const content = layoutContainer(id);
        size.set(id, {
          width: Math.max(FOLDER_MIN.width, content.width + FOLDER_PAD * 2),
          height: Math.max(FOLDER_MIN.height, content.height + FOLDER_HEADER + FOLDER_PAD),
        });
      }
    }

    const links = linksIn.get(containerId) ?? new Set();
    const placed =
      containerId !== null && kids.length > WRAP_AFTER
        ? grid(flowOrder(kids, links), size, Math.ceil(Math.sqrt(kids.length * 1.5)))
        : connectedThenGrid(kids, links, size, containerId === null ? 'top' : 'folder');

    const offset = containerId === null ? { x: 0, y: 0 } : { x: FOLDER_PAD, y: FOLDER_HEADER };
    for (const [id, p] of placed.positions)
      position.set(id, { x: p.x + offset.x, y: p.y + offset.y });
    routesIn.set(containerId, { routes: placed.routes, offset });
    return placed;
  };

  layoutContainer(null);

  const nodes = visible.map((v) => {
    const node = index.nodesById.get(v.id);
    const common = { name: node.name, path: node.path, hint: node.parentPath };
    const data =
      v.kind === 'file'
        ? {
            ...common,
            fanIn: node.metrics?.fanIn ?? 0,
            fanOut: node.metrics?.fanOut ?? 0,
            tier: tier.get(v.id),
          }
        : {
            ...common,
            fileCount: node.metrics?.fileCount ?? 0,
            expanded: v.expanded,
            depth: v.depth,
          };
    return {
      id: v.id,
      type: v.kind,
      position: position.get(v.id),
      // A node inside a folder can be dragged only within the folder's tray.
      ...(v.parentId ? { parentId: v.parentId, extent: 'parent' } : {}),
      ...size.get(v.id),
      data,
    };
  });

  /** A node's top-left corner in canvas coordinates. */
  const absolute = (id) => {
    let x = 0;
    let y = 0;
    for (let cur = id; cur != null; cur = visById.get(cur).parentId) {
      x += position.get(cur).x;
      y += position.get(cur).y;
    }
    return { x, y };
  };
  const handleBelow = (id) => {
    const a = absolute(id);
    return { x: a.x + size.get(id).width / 2, y: a.y + size.get(id).height };
  };
  const handleAbove = (id) => {
    const a = absolute(id);
    return { x: a.x + size.get(id).width / 2, y: a.y };
  };
  /**
   * The path an edge follows, in canvas coordinates, or null for a plain curve.
   * - It leaves the importer at its bottom centre and, when the importer sits inside expanded
   *   folders, leaves each of their trays through the tray's bottom centre (a port).
   * - At the innermost folder holding both ends it follows Dagre's route, which bends around
   *   the nodes on the ranks it passes.
   * - It enters each tray around the imported node through the tray's top centre, and ends at
   *   the node's top centre.
   * A bundle runs between siblings, so it uses no ports. An edge between neighbouring siblings
   * has no route and is drawn as a plain curve.
   * `label` is the segment (between points label and label + 1) that carries the count badge.
   */
  const routeOf = ({ container, sourceSide, targetSide }) => {
    const { routes, offset } = routesIn.get(container);
    const dagrePoints = routes.get(`${sourceSide.at(-1)}\n${targetSide.at(-1)}`) ?? [];
    if (sourceSide.length === 1 && targetSide.length === 1 && dagrePoints.length <= 3) return null;

    const origin = container === null ? { x: 0, y: 0 } : absolute(container);
    const middle = dagrePoints
      .slice(1, -1)
      .map((p) => ({ x: p.x + offset.x + origin.x, y: p.y + offset.y + origin.y }));
    const exits = sourceSide.map(handleBelow);
    const entries = targetSide.map(handleAbove).reverse();
    return {
      points: [...exits, ...middle, ...entries],
      label: exits.length - 1 + Math.floor(middle.length / 2),
    };
  };

  const isFolder = (id) => index.nodesById.get(id).type === 'folder';
  const toFlowEdge = (e, meet, detail) => {
    // Drawing order follows the deeper end, so an edge sits inside the tray it runs in.
    const depth = Math.max(visById.get(e.source).depth, visById.get(e.target).depth);
    const aggregated = e.count > 1 || isFolder(e.source) || isFolder(e.target);
    // A click on an aggregated edge expands its target when that is a collapsed folder (item 3).
    const target = visById.get(e.target);
    const expandPath =
      aggregated && target.kind === 'folder' && !target.expanded
        ? index.nodesById.get(e.target).path
        : null;
    return {
      id: e.id,
      ...(expandPath ? { className: 'has-expand' } : {}),
      source: e.source,
      target: e.target,
      type: 'aggregate',
      zIndex: detail ? depth + 1 : depth,
      data: {
        count: e.count,
        aggregated,
        expandPath,
        depth,
        detail,
        route: routeOf(meet),
      },
    };
  };

  const edges = [...bundles.values()].map((b) =>
    toFlowEdge(
      b,
      { container: b.container, sourceSide: [b.source], targetSide: [b.target] },
      false,
    ),
  );
  const detailEdges = details.map(({ edge, meet }) => toFlowEdge(edge, meet, true));

  return { nodes, edges, details: detailEdges };
}

/** Centrality cut-offs depend only on the graph, so they are computed once per index. */
const thresholdCache = new WeakMap();
function thresholdsFor(index) {
  let t = thresholdCache.get(index);
  if (!t) {
    t = centralityThresholds([...index.nodesById.values()]);
    thresholdCache.set(index, t);
  }
  return t;
}

/**
 * Orders a wrapped grid so it reads top to bottom like the rest of the canvas: children that
 * import their siblings come first, children their siblings import come last. Ties keep the
 * directory order (folders first, then by name).
 */
export function flowOrder(ids, links) {
  const score = new Map(ids.map((id) => [id, 0]));
  for (const key of links) {
    const [s, t] = key.split('\n');
    score.set(s, score.get(s) + 1);
    score.set(t, score.get(t) - 1);
  }
  return ids
    .map((id, i) => ({ id, i }))
    .sort((a, b) => score.get(b.id) - score.get(a.id) || a.i - b.i)
    .map((x) => x.id);
}

/**
 * Children with at least one link go through Dagre; the rest are packed in a grid centred
 * below them.
 */
function connectedThenGrid(ids, links, size, level) {
  const linked = new Set();
  for (const key of links) for (const id of key.split('\n')) linked.add(id);
  const connected = ids.filter((id) => linked.has(id));
  const loose = ids.filter((id) => !linked.has(id));

  const top = connected.length ? runDagre(connected, links, size, SPACING[level]) : empty();
  const widest = Math.max(...loose.map((id) => size.get(id).width), 0) + GAP;
  const fitCols = Math.floor((top.width + GAP) / Math.max(widest, 1));
  const cols = Math.min(loose.length, Math.max(level === 'top' ? 5 : 4, fitCols));
  const bottom = loose.length ? grid(loose, size, cols) : empty();

  const width = Math.max(top.width, bottom.width);
  const gapY = top.height && bottom.height ? SPACING[level].ranksep : 0;
  const positions = new Map();
  const shift = (from, dx, dy) => {
    for (const [id, p] of from.positions) positions.set(id, { x: p.x + dx, y: p.y + dy });
  };
  const topShift = (width - top.width) / 2;
  shift(top, topShift, 0);
  shift(bottom, (width - bottom.width) / 2, top.height + gapY);
  const routes = new Map();
  for (const [key, points] of top.routes) {
    routes.set(
      key,
      points.map((p) => ({ x: p.x + topShift, y: p.y })),
    );
  }
  return { positions, routes, width, height: top.height + gapY + bottom.height };
}

function runDagre(ids, links, size, spacing) {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: 'TB', ...spacing, marginx: 0, marginy: 0 });
  g.setDefaultEdgeLabel(() => ({}));
  for (const id of ids) g.setNode(id, { ...size.get(id) });
  for (const key of links) {
    const [s, t] = key.split('\n');
    g.setEdge(s, t);
  }
  dagre.layout(g);

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const raw = new Map();
  for (const id of ids) {
    const n = g.node(id);
    if (!Number.isFinite(n?.x) || !Number.isFinite(n?.y)) {
      throw new Error(`Dagre returned no position for node ${id}`);
    }
    const x = n.x - n.width / 2;
    const y = n.y - n.height / 2;
    raw.set(id, { x, y });
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + n.width);
    maxY = Math.max(maxY, y + n.height);
  }
  const positions = new Map();
  for (const [id, p] of raw) positions.set(id, { x: p.x - minX, y: p.y - minY });
  const routes = new Map();
  for (const key of links) {
    const [s, t] = key.split('\n');
    const points = g.edge(s, t)?.points ?? [];
    routes.set(
      key,
      points.map((p) => ({ x: p.x - minX, y: p.y - minY })),
    );
  }
  return { positions, routes, width: maxX - minX, height: maxY - minY };
}

/** A grid in the given order: each column as wide as its widest item, each row as tall as its tallest. */
function grid(ids, size, columns) {
  const cols = Math.max(1, Math.min(columns, ids.length));
  const colW = new Array(cols).fill(0);
  const rowH = new Array(Math.ceil(ids.length / cols)).fill(0);
  ids.forEach((id, i) => {
    const s = size.get(id);
    colW[i % cols] = Math.max(colW[i % cols], s.width);
    rowH[Math.floor(i / cols)] = Math.max(rowH[Math.floor(i / cols)], s.height);
  });
  const colX = prefix(colW);
  const rowY = prefix(rowH);
  const positions = new Map();
  ids.forEach((id, i) => {
    const c = i % cols;
    const s = size.get(id);
    positions.set(id, { x: colX[c] + (colW[c] - s.width) / 2, y: rowY[Math.floor(i / cols)] });
  });
  const total = (list) => list.reduce((a, b) => a + b, 0) + GAP * (list.length - 1);
  return { positions, routes: new Map(), width: total(colW), height: total(rowH) };
}

function prefix(list) {
  const out = [];
  let at = 0;
  for (const v of list) {
    out.push(at);
    at += v + GAP;
  }
  return out;
}

function empty() {
  return { positions: new Map(), routes: new Map(), width: 0, height: 0 };
}
