import { useMemo, useState } from 'react';
import { useWorkspaceStore } from '../../store/workspaceStore.js';
import AiPanel from '../ai/AiPanel.jsx';
import { countOf, SKIPPED_FILES } from '../repos/messages.js';

export const NO_EDGES = 'No internal dependencies were found between the analyzed files.';

/** @param {number} bytes */
export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** The files a file imports and the files that import it, as nodes, in path order. */
function neighbours(graph, id) {
  const imports = [];
  const usedBy = [];
  for (const e of graph.edges) {
    if (e.source === id) imports.push(graph.nodesById.get(e.target));
    if (e.target === id) usedBy.push(graph.nodesById.get(e.source));
  }
  const byPath = (a, b) => a.path.localeCompare(b.path);
  return { imports: imports.sort(byPath), usedBy: usedBy.sort(byPath) };
}

/** A collapsible list of files; each item selects that file. */
function FileList({ title, files, onSelect }) {
  const [open, setOpen] = useState(true);
  return (
    <section className="ins-list">
      <button
        type="button"
        className="ins-list-toggle"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <i className={`bi ${open ? 'bi-chevron-down' : 'bi-chevron-right'}`} aria-hidden="true" />
        {title} <span className="ins-count">{files.length}</span>
      </button>
      {open && (
        <ul>
          {files.map((f) => (
            <li key={f.id}>
              <button type="button" className="ins-file-link" onClick={() => onSelect(f.id)}>
                {f.path}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function RepositoryFacts({ files, edges, unresolved, skipped }) {
  const [showUnresolved, setShowUnresolved] = useState(false);
  return (
    <>
      <div className="ins-empty">
        <i className="bi bi-cursor" aria-hidden="true" />
        <p>Click a file to inspect it.</p>
      </div>
      <dl className="ins-facts">
        <div>
          <dt>Files</dt>
          <dd>{files}</dd>
        </div>
        <div>
          <dt>Dependencies</dt>
          <dd>{edges}</dd>
        </div>
        <div>
          <dt>Unresolved imports</dt>
          <dd>
            {unresolved.count}
            {unresolved.count > 0 && (
              <button
                type="button"
                className="ins-link"
                aria-expanded={showUnresolved}
                onClick={() => setShowUnresolved(!showUnresolved)}
              >
                {showUnresolved ? 'Hide' : 'Show'}
              </button>
            )}
          </dd>
        </div>
      </dl>
      {showUnresolved && (
        <ul className="ins-unresolved">
          {unresolved.items.map((u, i) => (
            <li key={i}>
              <span className="ins-mono">{u.sourcePath}</span>
              <span className="ins-mono ins-specifier">{u.specifier}</span>
              <span className="ins-reason">{u.reason}</span>
            </li>
          ))}
        </ul>
      )}
      {edges === 0 && <p className="ins-note">{NO_EDGES}</p>}
      {skipped > 0 && <p className="ins-note">{SKIPPED_FILES(skipped)}</p>}
    </>
  );
}

function FileDetails({ node, repoId }) {
  const graph = useWorkspaceStore((s) => s.graph);
  const selectFile = useWorkspaceStore((s) => s.selectFile);
  const openCode = useWorkspaceStore((s) => s.openCode);
  const { imports, usedBy } = useMemo(() => neighbours(graph, node.id), [graph, node.id]);
  return (
    <>
      <header className="ins-header">
        <h2 className="ins-path ins-mono">{node.path}</h2>
        {node.language && <span className="ins-language">{node.language}</span>}
      </header>
      <dl className="ins-facts">
        <div>
          <dt>Size</dt>
          <dd>{formatBytes(node.sizeBytes ?? 0)}</dd>
        </div>
      </dl>
      <p className="ins-counts">
        Imports {imports.length} · Used by {usedBy.length}
      </p>
      <FileList title="Imports" files={imports} onSelect={selectFile} />
      <FileList title="Used by" files={usedBy} onSelect={selectFile} />
      <button type="button" className="btn btn-outline-secondary ins-action" onClick={openCode}>
        View code
      </button>
      <AiPanel repoId={repoId} nodeId={node.id} />
    </>
  );
}

function FolderDetails({ node }) {
  const expandFolder = useWorkspaceStore((s) => s.expandFolder);
  return (
    <>
      <header className="ins-header">
        <h2 className="ins-path ins-mono">{node.path}</h2>
      </header>
      <p className="ins-note">{countOf(node.metrics?.fileCount ?? 0, 'file', 'files')}</p>
      <button
        type="button"
        className="btn btn-outline-secondary ins-action"
        onClick={() => expandFolder(node.path)}
      >
        Expand on canvas
      </button>
    </>
  );
}

/**
 * The insights panel (spec 8.6): what is known about the selection without AI. Nothing selected
 * shows the repository's facts; a file shows its size, imports and importers; a folder shows its
 * file count. A file also gets the AI panel (Analyze and its states).
 * @param {{ repoId: string, unresolved: { count: number, items: object[] }, skippedFiles?: number }} props
 */
export default function InsightsPanel({ repoId, unresolved, skippedFiles = 0 }) {
  const graph = useWorkspaceStore((s) => s.graph);
  const selected = useWorkspaceStore((s) => s.graph?.nodesById.get(s.selectedNodeId));
  const files = useMemo(
    () => [...graph.nodesById.values()].filter((n) => n.type === 'file').length,
    [graph],
  );

  return (
    <aside className="ins-panel" aria-label="Insights">
      {selected?.type === 'file' && (
        <FileDetails key={selected.id} node={selected} repoId={repoId} />
      )}
      {selected?.type === 'folder' && <FolderDetails key={selected.id} node={selected} />}
      {!selected && (
        <RepositoryFacts
          files={files}
          edges={graph.edges.length}
          unresolved={unresolved}
          skipped={skippedFiles}
        />
      )}
    </aside>
  );
}
