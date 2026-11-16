import { useCallback, useEffect, useState } from 'react';
import Modal from 'react-bootstrap/Modal';
import Tab from 'react-bootstrap/Tab';
import Tabs from 'react-bootstrap/Tabs';
import { Link } from 'react-router-dom';
import { listGithubRepos } from '../../api/repos.js';
import { formatDate } from './messages.js';
import { parseRepoInput } from './repoInput.js';
import { handleUnauthenticated, tryAddRepo } from './useRepositories.js';

/** Posts a repository and reports the new card to `onAdded`; failures become an inline error. */
function useSubmit(onAdded) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const submit = async (repo) => {
    setBusy(true);
    setError(null);
    const result = await tryAddRepo(repo);
    setBusy(false);
    if (result.repository) onAdded(result.repository);
    else if (result.error) setError(result.error);
  };
  return { busy, error, submit };
}

function InlineError({ error }) {
  if (!error) return null;
  return (
    <p className="modal-inline-error" role="alert">
      {error.message}
      {error.code === 'REPO_ALREADY_ANALYZED' && error.repositoryId && (
        <>
          {' '}
          <Link to={`/repos/${error.repositoryId}`}>Open graph</Link>
        </>
      )}
    </p>
  );
}

function GithubTab({ onAdded }) {
  const [items, setItems] = useState([]);
  const [nextPage, setNextPage] = useState(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [filter, setFilter] = useState('');
  const { busy, error, submit } = useSubmit(onAdded);

  const load = useCallback(async (target) => {
    setLoading(true);
    setFailed(false);
    setPage(target);
    try {
      const data = await listGithubRepos(target);
      setItems((cur) => (target === 1 ? data.items : [...cur, ...data.items]));
      setNextPage(data.nextPage);
    } catch (err) {
      if (!handleUnauthenticated(err)) setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const first = setTimeout(() => load(1), 0);
    return () => clearTimeout(first);
  }, [load]);

  const q = filter.trim().toLowerCase();
  const shown = q ? items.filter((r) => r.fullName.toLowerCase().includes(q)) : items;

  return (
    <div className="analyze-tab">
      <input
        type="search"
        className="form-control mb-3"
        placeholder="Filter your repositories…"
        aria-label="Filter your repositories"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
      />
      <InlineError error={error} />
      <ul className="analyze-list">
        {shown.map((r) => (
          <li key={r.fullName} className="analyze-row">
            <div className="analyze-row-text">
              <span className="repo-name">{r.fullName}</span>
              {r.description && <span className="analyze-desc">{r.description}</span>}
              <span className="analyze-meta">
                {[r.language, r.updatedAt && formatDate(r.updatedAt)].filter(Boolean).join(' · ')}
              </span>
            </div>
            {r.alreadyAdded ? (
              <span className="analyze-added">Already added</span>
            ) : (
              <button
                type="button"
                className="btn btn-primary btn-sm"
                disabled={busy}
                onClick={() => submit(r.fullName)}
                aria-label={`Analyze ${r.fullName}`}
              >
                Analyze
              </button>
            )}
          </li>
        ))}
      </ul>
      {loading && (
        <div className="text-center py-3">
          <div className="spinner-border spinner-border-sm" role="status">
            <span className="visually-hidden">Loading…</span>
          </div>
        </div>
      )}
      {failed && (
        <div className="analyze-failed">
          <p>Couldn&apos;t load your repositories from GitHub.</p>
          <button type="button" className="btn btn-quiet" onClick={() => load(page)}>
            Retry
          </button>
        </div>
      )}
      {!loading && !failed && items.length === 0 && (
        <p className="text-body-secondary">No public repositories found on your GitHub account.</p>
      )}
      {!loading && !failed && nextPage && (
        <button type="button" className="btn btn-quiet w-100" onClick={() => load(nextPage)}>
          Load more
        </button>
      )}
    </div>
  );
}

function UrlTab({ onAdded }) {
  const [value, setValue] = useState('');
  const { busy, error, submit } = useSubmit(onAdded);
  const valid = parseRepoInput(value) !== null;

  return (
    <form
      className="analyze-tab"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid && !busy) submit(value.trim());
      }}
    >
      <label htmlFor="analyze-url" className="visually-hidden">
        Public repository
      </label>
      <div className="d-flex gap-2">
        <input
          id="analyze-url"
          className="form-control"
          placeholder="owner/name or https://github.com/owner/name"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          autoComplete="off"
        />
        <button type="submit" className="btn btn-primary" disabled={!valid || busy}>
          Analyze
        </button>
      </div>
      <InlineError error={error} />
    </form>
  );
}

/** The analyze modal (spec 8.5): 640 px, two tabs. `onAdded` receives the new repository. */
export default function AnalyzeModal({ show, onHide, onAdded }) {
  return (
    <Modal show={show} onHide={onHide} dialogClassName="analyze-modal" centered>
      <Modal.Header closeButton>
        <Modal.Title as="h2">Analyze a repository</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <Tabs defaultActiveKey="github" mountOnEnter>
          <Tab eventKey="github" title="From your GitHub" className="pt-3">
            <GithubTab onAdded={onAdded} />
          </Tab>
          <Tab eventKey="url" title="Any public repository" className="pt-3">
            <UrlTab onAdded={onAdded} />
          </Tab>
        </Tabs>
      </Modal.Body>
    </Modal>
  );
}
