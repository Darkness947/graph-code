import { useState } from 'react';
import AnalyzeModal from '../features/repos/AnalyzeModal.jsx';
import EmptyState from '../features/repos/EmptyState.jsx';
import RemoveRepoModal from '../features/repos/RemoveRepoModal.jsx';
import RepoCard from '../features/repos/RepoCard.jsx';
import { GENERIC_ERROR, REPO_REMOVED } from '../features/repos/messages.js';
import { tryAddRepo, useRepositories } from '../features/repos/useRepositories.js';
import { showToast } from '../store/toastStore.js';

/** Dashboard (spec 8.5). */
export default function Dashboard() {
  const { items, error, refresh, upsert, remove } = useRepositories();
  const [modal, setModal] = useState(false);
  const [removing, setRemoving] = useState(null);
  const [filter, setFilter] = useState('');

  const retry = async (repo) => {
    const { repository, error: failure } = await tryAddRepo(`${repo.owner}/${repo.name}`);
    if (repository) upsert(repository);
    else if (failure) showToast(failure.message);
  };

  const q = filter.trim().toLowerCase();
  const shown = (items ?? []).filter((r) => !q || r.displayName.toLowerCase().includes(q));

  return (
    <div className="page-container">
      <div className="dash-header">
        <h1>Your Repositories</h1>
        <input
          type="search"
          className="form-control dash-filter"
          placeholder="Filter repositories…"
          aria-label="Filter repositories"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <button type="button" className="btn btn-primary" onClick={() => setModal(true)}>
          Analyze a repository
        </button>
      </div>

      {items === null && !error && (
        <div className="text-center py-5">
          <div className="spinner-border text-primary" role="status">
            <span className="visually-hidden">Loading…</span>
          </div>
        </div>
      )}
      {items === null && error && <p role="alert">{GENERIC_ERROR}</p>}
      {items?.length === 0 && <EmptyState onAnalyze={() => setModal(true)} />}
      {items?.length > 0 && (
        <div className="repo-grid">
          {shown.map((r) => (
            <RepoCard key={r.id} repo={r} onRetry={retry} onRemove={setRemoving} />
          ))}
        </div>
      )}

      <RemoveRepoModal
        repo={removing}
        onHide={() => setRemoving(null)}
        onRemoved={(repo) => {
          remove(repo.id);
          setRemoving(null);
          showToast(REPO_REMOVED);
        }}
        onBlocked={refresh}
      />

      <AnalyzeModal
        show={modal}
        onHide={() => setModal(false)}
        onAdded={(repo) => {
          upsert(repo);
          setModal(false);
        }}
      />
    </div>
  );
}
