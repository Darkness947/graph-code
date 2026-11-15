import { useState } from 'react';
import { addRepo } from '../api/repos.js';
import AnalyzeModal from '../features/repos/AnalyzeModal.jsx';
import EmptyState from '../features/repos/EmptyState.jsx';
import RepoCard from '../features/repos/RepoCard.jsx';
import { addErrorMessage } from '../features/repos/messages.js';
import { handleUnauthenticated, useRepositories } from '../features/repos/useRepositories.js';
import { showToast } from '../store/toastStore.js';

/** Dashboard (spec 8.5). Removing a repository arrives in T2.7. */
export default function Dashboard() {
  const { items, error, upsert } = useRepositories();
  const [modal, setModal] = useState(false);
  const [filter, setFilter] = useState('');

  const retry = async (repo) => {
    try {
      const { repository } = await addRepo(`${repo.owner}/${repo.name}`);
      upsert(repository);
    } catch (err) {
      if (!handleUnauthenticated(err)) showToast(addErrorMessage(err));
    }
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
      {items === null && error && <p role="alert">Something went wrong. Try again.</p>}
      {items?.length === 0 && <EmptyState onAnalyze={() => setModal(true)} />}
      {items?.length > 0 && (
        <div className="repo-grid">
          {shown.map((r) => (
            <RepoCard key={r.id} repo={r} onRetry={retry} />
          ))}
        </div>
      )}

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
