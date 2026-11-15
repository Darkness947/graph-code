import { useState } from 'react';
import OverlayTrigger from 'react-bootstrap/OverlayTrigger';
import Tooltip from 'react-bootstrap/Tooltip';
import { Link } from 'react-router-dom';
import ProgressBlock from './ProgressBlock.jsx';
import { SKIPPED_FILES } from './messages.js';
import { isAnalyzing } from './useRepositories.js';

const DATE_FORMAT = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

const formatSynced = (iso) => (iso ? DATE_FORMAT.format(new Date(iso)) : null);

const BADGES = {
  ready: { text: 'Ready', className: 'repo-badge-ready' },
  analyzing: { text: 'Analyzing', className: 'repo-badge-analyzing' },
  failed: { text: 'Failed', className: 'repo-badge-failed' },
};

/** One repository card (spec 8.5). Removing is wired in T2.7 through `onRemove`. */
export default function RepoCard({ repo, onRetry, onRemove }) {
  const [retrying, setRetrying] = useState(false);
  const analyzing = isAnalyzing(repo);
  const state = analyzing ? 'analyzing' : repo.status === 'failed' ? 'failed' : 'ready';
  const badge = BADGES[state];
  const job = repo.latestJob;
  const skipped = job?.filesSkipped ?? 0;
  const languages = Object.keys(repo.languageSummary ?? {});
  const synced = formatSynced(repo.lastIngestedAt);

  const retry = async () => {
    setRetrying(true);
    try {
      await onRetry(repo);
    } finally {
      setRetrying(false);
    }
  };

  const removeButton = (
    <button
      type="button"
      className="btn btn-quiet repo-remove"
      aria-label="Remove repository"
      disabled={analyzing}
      onClick={() => onRemove?.(repo)}
    >
      <i className="bi bi-trash" aria-hidden="true" />
    </button>
  );

  return (
    <article className="repo-card" aria-label={repo.displayName}>
      <div className="repo-card-top">
        <span className="repo-name">
          {repo.owner}/<strong>{repo.name}</strong>
        </span>
        <span className={`repo-badge ${badge.className}`}>{badge.text}</span>
        {state === 'ready' &&
          languages.map((l) => (
            <span key={l} className="repo-lang">
              {l}
            </span>
          ))}
      </div>

      {state === 'analyzing' && <ProgressBlock job={job} />}

      {state === 'ready' && (
        <>
          <p className="repo-meta">
            {repo.fileCount} files · {repo.edgeCount} dependencies
            {synced ? ` · synced ${synced}` : ''}
          </p>
          {skipped > 0 && <p className="repo-meta">{SKIPPED_FILES(skipped)}</p>}
        </>
      )}

      {state === 'failed' && (
        <p className="repo-failed">
          <i className="bi bi-exclamation-circle-fill" aria-hidden="true" />
          <span>
            {job?.errorMessage ?? 'Something went wrong while saving the graph. Try again.'}
          </span>
        </p>
      )}

      <div className="repo-actions">
        {state === 'failed' ? (
          <button type="button" className="btn btn-primary" onClick={retry} disabled={retrying}>
            Try again
          </button>
        ) : state === 'ready' ? (
          <Link className="btn btn-primary" to={`/repos/${repo.id}`}>
            Open graph
          </Link>
        ) : (
          <button type="button" className="btn btn-primary" disabled>
            Open graph
          </button>
        )}
        {analyzing ? (
          <OverlayTrigger overlay={<Tooltip>Wait for analysis to finish</Tooltip>}>
            <span className="repo-remove-wrap" tabIndex={0}>
              {removeButton}
            </span>
          </OverlayTrigger>
        ) : (
          removeButton
        )}
      </div>
    </article>
  );
}
