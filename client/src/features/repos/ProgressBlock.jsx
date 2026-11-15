import { phaseLabel, tierLine } from './messages.js';

/** Progress for an analyzing card (spec 8.5): amber bar, phase label, tier line. */
export default function ProgressBlock({ job }) {
  const total = job?.filesTotal ?? null;
  const determinate = total !== null && total > 0;
  const pct = determinate
    ? Math.min(100, Math.round(((job.filesProcessed ?? 0) / total) * 100))
    : 0;
  const tier = tierLine(total);
  return (
    <div className="repo-progress">
      <div
        className="progress repo-progress-bar"
        role="progressbar"
        aria-label="Analysis progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={determinate ? pct : undefined}
      >
        <div
          className={`progress-bar${determinate ? '' : ' progress-bar-striped progress-bar-animated'}`}
          style={{ width: determinate ? `${pct}%` : '100%' }}
        />
      </div>
      <p className="repo-progress-label">{phaseLabel(job)}</p>
      {tier && <p className="repo-progress-tier">{tier}</p>}
    </div>
  );
}
