import { useState } from 'react';
import { useWorkspaceStore } from '../../store/workspaceStore.js';
import { fileIdByPath } from '../graph/graphIndex.js';
import { useSessionStore } from '../auth/useSession.js';
import { analysisInFlight } from './aiHighlight.js';
import AiNoticeModal from './AiNoticeModal.jsx';
import { runAnalysis } from './runAnalysis.js';
import './ai.css';
import {
  aiErrorIcon,
  aiErrorMessage,
  ANALYZE,
  ANALYZING,
  DISCLAIMER,
  MORE_FILES,
  NO_DEPENDENTS,
  REMOVED_NOTE,
} from './messages.js';

/** How many risk cards show before "+N more files" (spec 8.6). */
export const CARD_LIMIT = 25;

const LEVEL_LABEL = { high: 'High', medium: 'Medium', low: 'Low' };

/** One predicted risk: the path (selects the file), its level and the model's reason. */
function RiskCard({ risk, fileId, onSelect }) {
  return (
    <li className="ai-card">
      <div className="ai-card-head">
        {fileId ? (
          <button
            type="button"
            className="ins-file-link ai-card-path"
            onClick={() => onSelect(fileId)}
          >
            {risk.path}
          </button>
        ) : (
          <span className="ai-card-path ins-mono">{risk.path}</span>
        )}
        <span className={`ai-level ai-level-${risk.level}`}>{LEVEL_LABEL[risk.level]}</span>
      </div>
      <p className="ai-reason">{risk.reason}</p>
    </li>
  );
}

/** The "AI result" state (spec 8.6). */
function AiResult({ result }) {
  const graph = useWorkspaceStore((s) => s.graph);
  const selectFile = useWorkspaceStore((s) => s.selectFile);
  const [showAll, setShowAll] = useState(false);
  const idByPath = fileIdByPath(graph);
  const risks = showAll ? result.risks : result.risks.slice(0, CARD_LIMIT);
  const hidden = result.risks.length - risks.length;

  return (
    <section className="ai-result" aria-labelledby="ai-result-title">
      <header className="ai-result-head">
        <h3 id="ai-result-title">Change impact</h3>
        <span className="ai-badge">AI-generated</span>
        {result.cached && <span className="ai-badge">Cached</span>}
      </header>
      <p className="ai-summary">{result.summary}</p>
      <ul className="ai-cards">
        {risks.map((r) => (
          <RiskCard key={r.path} risk={r} fileId={idByPath.get(r.path)} onSelect={selectFile} />
        ))}
      </ul>
      {hidden > 0 && (
        <button type="button" className="ins-link" onClick={() => setShowAll(true)}>
          {MORE_FILES(hidden)}
        </button>
      )}
      {result.removedCount > 0 && (
        <p className="ai-footnote">{REMOVED_NOTE(result.removedCount)}</p>
      )}
      <p className="ai-disclaimer">{DISCLAIMER}</p>
    </section>
  );
}

/**
 * The AI part of the insights panel for one file (spec 8.6): the Analyze button, then the
 * loading, result, no-dependents and error states. The first analysis asks for the AI notice.
 * The button is disabled while any analysis is in flight.
 * @param {{ repoId: string, nodeId: string }} props
 */
export default function AiPanel({ repoId, nodeId }) {
  const entry = useWorkspaceStore((s) => s.aiByNodeId[nodeId]);
  const busy = useWorkspaceStore(analysisInFlight);
  const acknowledged = useSessionStore((s) => s.user?.aiNoticeAcknowledged === true);
  const [notice, setNotice] = useState(false);
  const run = () => runAnalysis(repoId, nodeId);
  const analyze = () => (acknowledged ? run() : setNotice(true));
  const status = entry?.status ?? 'idle';

  return (
    <div className="ai-panel">
      {status !== 'error' && (
        <button
          type="button"
          className="btn btn-primary ins-action ai-analyze"
          onClick={analyze}
          disabled={busy}
          aria-busy={status === 'loading'}
        >
          {status === 'loading' ? (
            <>
              <span className="spinner-border spinner-border-sm" aria-hidden="true" /> {ANALYZING}
            </>
          ) : (
            ANALYZE
          )}
        </button>
      )}
      {status === 'success' &&
        (entry.result.noDependents ? (
          <div className="ai-state ai-safe">
            <i className="bi bi-check-circle-fill" aria-hidden="true" />
            <p>{NO_DEPENDENTS}</p>
          </div>
        ) : (
          <AiResult result={entry.result} />
        ))}
      {status === 'error' && (
        <div className="ai-state ai-error" role="alert">
          <i className={`bi ${aiErrorIcon(entry.errorCode)}`} aria-hidden="true" />
          <p>{aiErrorMessage(entry.errorCode, entry.retryAfterSeconds)}</p>
          <button
            type="button"
            className="btn btn-outline-secondary"
            onClick={analyze}
            disabled={busy}
          >
            Try again
          </button>
        </div>
      )}
      <AiNoticeModal show={notice} onHide={() => setNotice(false)} onConfirmed={run} />
    </div>
  );
}
