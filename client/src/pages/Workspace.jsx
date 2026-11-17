import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { getGraph } from '../api/repos.js';
import MessagePanel from '../components/MessagePanel.jsx';
import PageSpinner from '../components/PageSpinner.jsx';
import GraphCanvas from '../features/graph/GraphCanvas.jsx';
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

/** Graph workspace (spec 8.6). The canvas is drawn from the workspace store. */
export default function Workspace() {
  const { id } = useParams();
  const loadGraph = useWorkspaceStore((s) => s.loadGraph);
  const reset = useWorkspaceStore((s) => s.reset);
  const [state, setState] = useState({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

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
    const { code, message } = state.error;
    if (code === 'NOT_FOUND' || code === 'GRAPH_NOT_READY') {
      return (
        <MessagePanel
          icon={code === 'NOT_FOUND' ? 'bi-question-circle' : 'bi-hourglass-split'}
          title={code === 'NOT_FOUND' ? 'Repository not found' : 'Graph not ready yet'}
          text={message}
        >
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
      <div className="ws-body">
        <GraphCanvas key={id} />
      </div>
    </div>
  );
}
