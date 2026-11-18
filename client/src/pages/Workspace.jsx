import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { getGraph } from '../api/repos.js';
import MessagePanel from '../components/MessagePanel.jsx';
import PageSpinner from '../components/PageSpinner.jsx';
import CodeDrawer from '../features/code/CodeDrawer.jsx';
import GraphCanvas from '../features/graph/GraphCanvas.jsx';
import InsightsPanel from '../features/insights/InsightsPanel.jsx';
import { countOf, formatDate, GENERIC_ERROR } from '../features/repos/messages.js';
import { handleUnauthenticated } from '../features/repos/useRepositories.js';
import { useWorkspaceStore } from '../store/workspaceStore.js';

/** The 40 px strip above the workspace (spec 8.6 layout). */
function HeaderStrip({ repository, files, edges }) {
  return (
    <header className="ws-strip">
      <nav aria-label="Breadcrumb" className="ws-crumbs">
        <Link to="/dashboard">Dashboard</Link>
        <span className="ws-crumb-sep" aria-hidden="true">
          /
        </span>
        <span className="ws-repo" aria-current="page">
          {repository.owner}/<strong>{repository.name}</strong>
        </span>
      </nav>
      {repository.lastIngestedAt && (
        <span className="ws-meta">Synced {formatDate(repository.lastIngestedAt)}</span>
      )}
      <span className="ws-meta">
        {countOf(files, 'file', 'files')} · {countOf(edges, 'dependency', 'dependencies')}
      </span>
      <Link to="/dashboard" className="ws-back">
        Back to dashboard
      </Link>
    </header>
  );
}

/** Errors that send the user back to the dashboard, with the server's message as the text. */
const KNOWN_ERRORS = {
  NOT_FOUND: { icon: 'bi-question-circle', title: 'Repository not found' },
  GRAPH_NOT_READY: { icon: 'bi-hourglass-split', title: 'Graph not ready yet' },
};

/** Graph workspace (spec 8.6). The canvas is drawn from the workspace store. */
export default function Workspace() {
  const { id } = useParams();
  const loadGraph = useWorkspaceStore((s) => s.loadGraph);
  const reset = useWorkspaceStore((s) => s.reset);
  const [state, setState] = useState({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const bodyRef = useRef(null);

  useEffect(() => {
    let live = true;
    getGraph(id).then(
      (graph) => {
        if (!live) return;
        loadGraph(graph);
        const files = graph.nodes.filter((n) => n.type === 'file').length;
        setState({
          status: 'ready',
          repository: graph.repository,
          files,
          edges: graph.edges.length,
          unresolved: graph.unresolved,
          skipped: graph.repository.latestJob?.filesSkipped ?? 0,
        });
      },
      (err) => {
        if (!live || handleUnauthenticated(err)) return;
        setState({ status: 'error', error: err });
      },
    );
    return () => {
      live = false;
      reset();
    };
  }, [id, attempt, loadGraph, reset]);

  const retry = () => {
    setState({ status: 'loading' });
    setAttempt((n) => n + 1);
  };

  if (state.status === 'loading') {
    return <PageSpinner label="Loading graph…" />;
  }

  if (state.status === 'error') {
    const known = KNOWN_ERRORS[state.error.code];
    if (known) {
      return (
        <MessagePanel icon={known.icon} title={known.title} text={state.error.message}>
          <Link to="/dashboard" className="btn btn-primary">
            Back to dashboard
          </Link>
        </MessagePanel>
      );
    }
    return (
      <MessagePanel
        icon="bi-exclamation-circle"
        failure
        title="Couldn't load the graph"
        text={GENERIC_ERROR}
      >
        <button type="button" className="btn btn-primary" onClick={retry}>
          Try again
        </button>
      </MessagePanel>
    );
  }

  return (
    <div className="workspace">
      <HeaderStrip repository={state.repository} files={state.files} edges={state.edges} />
      <div className="ws-body" ref={bodyRef}>
        <div className="ws-main">
          <div className="ws-canvas">
            <GraphCanvas key={id} />
          </div>
          <InsightsPanel unresolved={state.unresolved} skippedFiles={state.skipped} />
        </div>
        <CodeDrawer repoId={id} containerRef={bodyRef} />
      </div>
    </div>
  );
}
