/**
 * Placeholder for the landing page's hero visual (spec 8.4), used until the real
 * `hero-workspace.png` arrives in S-11. It draws a small dependency graph in the workspace's
 * own visual language: one selected file in blue, its edges lit, everything else at rest.
 */

const SELECTED = 'session';

const NODES = [
  { id: 'main', label: 'main.jsx', x: 480, y: 44 },
  { id: 'app', label: 'App.jsx', x: 480, y: 128 },
  { id: 'guard', label: 'ProtectedRoute.jsx', x: 150, y: 212 },
  { id: 'nav', label: 'NavBar.jsx', x: 380, y: 212 },
  { id: 'landing', label: 'Landing.jsx', x: 590, y: 212 },
  { id: 'dashboard', label: 'Dashboard.jsx', x: 810, y: 212 },
  { id: 'session', label: 'useSession.js', x: 380, y: 304 },
  { id: 'card', label: 'RepoCard.jsx', x: 810, y: 304 },
  { id: 'client', label: 'client.js', x: 380, y: 394 },
  { id: 'format', label: 'formatDate.js', x: 810, y: 394 },
];

// Importer -> imported, drawn top to bottom.
const EDGES = [
  ['main', 'app'],
  ['app', 'guard'],
  ['app', 'nav'],
  ['app', 'landing'],
  ['app', 'dashboard'],
  ['guard', 'session'],
  ['nav', 'session'],
  ['landing', 'session'],
  ['dashboard', 'session'],
  ['dashboard', 'card'],
  ['session', 'client'],
  ['card', 'format'],
];

const byId = Object.fromEntries(NODES.map((n) => [n.id, n]));
const height = (id) => (id === SELECTED ? 42 : 32);
const width = (node) => node.label.length * (node.id === SELECTED ? 8.4 : 7.6) + 30;
const touchesSelected = ([from, to]) => from === SELECTED || to === SELECTED;
const linked = new Set(EDGES.filter(touchesSelected).flat());

function edgePath([fromId, toId]) {
  const from = byId[fromId];
  const to = byId[toId];
  const y1 = from.y + height(fromId) / 2;
  const y2 = to.y - height(toId) / 2;
  const mid = (y1 + y2) / 2;
  return `M${from.x},${y1} C${from.x},${mid} ${to.x},${mid} ${to.x},${y2}`;
}

export default function WorkspacePreview() {
  return (
    <div className="hero-visual">
      <svg viewBox="0 0 960 440" aria-hidden="true">
        {EDGES.map((edge) => (
          <path
            key={edge.join('>')}
            className={`preview-edge${touchesSelected(edge) ? ' is-active' : ''}`}
            d={edgePath(edge)}
            pathLength="1"
          />
        ))}
        {NODES.map((node) => {
          const w = width(node);
          const h = height(node.id);
          const state =
            node.id === SELECTED ? ' is-selected' : linked.has(node.id) ? ' is-linked' : '';
          return (
            <g key={node.id} className={`preview-node${state}`}>
              <rect x={node.x - w / 2} y={node.y - h / 2} width={w} height={h} rx="6" />
              <text x={node.x} y={node.y}>
                {node.label}
              </text>
            </g>
          );
        })}
      </svg>
      <span className="hero-visual-label">Workspace preview</span>
    </div>
  );
}
