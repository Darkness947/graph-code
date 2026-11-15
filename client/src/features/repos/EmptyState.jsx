/** Shown when the user has no repositories (spec 8.5). */
export default function EmptyState({ onAnalyze }) {
  return (
    <div className="repo-empty">
      <i className="bi bi-diagram-3" aria-hidden="true" />
      <h2>Analyze your first repository</h2>
      <p>Pick one of your public repositories or paste any public GitHub repository.</p>
      <button type="button" className="btn btn-primary btn-lg" onClick={onAnalyze}>
        Analyze a repository
      </button>
    </div>
  );
}
