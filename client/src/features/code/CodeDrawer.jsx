import { Highlight } from 'prism-react-renderer';
import { useCallback, useEffect, useState } from 'react';
import { getSource } from '../../api/repos.js';
import { useWorkspaceStore } from '../../store/workspaceStore.js';
import { handleUnauthenticated } from '../repos/useRepositories.js';
import { codeTheme, MAX_HIGHLIGHT_LINES, prismLanguage } from './codeLanguage.js';

export const TOO_LARGE = 'This file is too large to display (over 1 MB).';
export const LOAD_FAILED = "Couldn't load this file from GitHub.";

/**
 * Loads a file's source; reloads when the file changes or `reload` is called. A result belongs
 * to the file and attempt that asked for it, so another file's result never shows under this
 * file's name, and a retry shows the skeleton again.
 */
function useSource(repoId, nodeId) {
  const [result, setResult] = useState({ key: null });
  const [attempt, setAttempt] = useState(0);
  const key = nodeId ? `${nodeId}#${attempt}` : null;

  useEffect(() => {
    if (!nodeId) return undefined;
    let live = true;
    const settle = (next) => live && setResult({ key: `${nodeId}#${attempt}`, ...next });
    getSource(repoId, nodeId).then(
      (data) => settle(data.tooLarge ? { status: 'tooLarge' } : { status: 'ready', data }),
      (err) => {
        if (!handleUnauthenticated(err)) settle({ status: 'error' });
      },
    );
    return () => {
      live = false;
    };
  }, [repoId, nodeId, attempt]);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);
  return [result.key === key ? result : { status: 'loading' }, reload];
}

function CodeLines({ path, content }) {
  const lines = content.split('\n').length;
  if (lines > MAX_HIGHLIGHT_LINES) {
    return (
      <pre className="code-pre" data-highlighted="false">
        {content.split('\n').map((line, i) => (
          <div key={i} className="code-line">
            <span className="code-no">{i + 1}</span>
            <span>{line}</span>
          </div>
        ))}
      </pre>
    );
  }
  return (
    <Highlight theme={codeTheme} code={content} language={prismLanguage(path)}>
      {({ tokens, getLineProps, getTokenProps }) => (
        <pre className="code-pre" data-highlighted="true">
          {tokens.map((line, i) => (
            <div key={i} {...getLineProps({ line, className: 'code-line' })}>
              <span className="code-no">{i + 1}</span>
              <span>
                {line.map((token, k) => (
                  <span key={k} {...getTokenProps({ token })} />
                ))}
              </span>
            </div>
          ))}
        </pre>
      )}
    </Highlight>
  );
}

function Body({ file, source, reload }) {
  if (!file) return <p className="code-note">Select a file to view its code.</p>;
  if (source.status === 'loading' || source.status === 'idle') {
    return (
      <div className="code-skeleton" role="status" aria-label="Loading code">
        {Array.from({ length: 8 }, (_, i) => (
          <span key={i} style={{ width: `${40 + ((i * 17) % 50)}%` }} />
        ))}
      </div>
    );
  }
  if (source.status === 'tooLarge') return <p className="code-note">{TOO_LARGE}</p>;
  if (source.status === 'error') {
    return (
      <div className="code-note">
        <p>{LOAD_FAILED}</p>
        <button type="button" className="btn btn-outline-secondary btn-sm" onClick={reload}>
          Retry
        </button>
      </div>
    );
  }
  return <CodeLines path={file.path} content={source.data.content} />;
}

/**
 * The code drawer (spec 8.6): a 28 px handle that opens to a panel showing the selected file,
 * resizable by dragging its top edge between 20% and 70% of the workspace height.
 * @param {{ repoId: string, containerRef: { current: HTMLElement | null } }} props
 *   `containerRef` is the workspace body, whose height the drawer's percentage refers to.
 */
export default function CodeDrawer({ repoId, containerRef }) {
  const { open, heightPct } = useWorkspaceStore((s) => s.codeDrawer);
  const openCode = useWorkspaceStore((s) => s.openCode);
  const closeCode = useWorkspaceStore((s) => s.closeCode);
  const setCodeHeight = useWorkspaceStore((s) => s.setCodeHeight);
  const file = useWorkspaceStore((s) => {
    const node = s.graph?.nodesById.get(s.selectedNodeId);
    return node?.type === 'file' ? node : null;
  });
  const [source, reload] = useSource(repoId, open ? file?.id : null);

  const startResize = (event) => {
    const box = containerRef.current?.getBoundingClientRect();
    if (!box) return;
    event.preventDefault();
    const move = (e) => setCodeHeight(((box.bottom - e.clientY) / box.height) * 100);
    const stop = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop);
  };

  if (!open) {
    return (
      <div className="code-drawer is-closed">
        <button type="button" className="code-handle" aria-expanded="false" onClick={openCode}>
          Code <i className="bi bi-chevron-up" aria-hidden="true" />
        </button>
      </div>
    );
  }

  return (
    <section className="code-drawer" aria-label="Code" style={{ height: `${heightPct}%` }}>
      <div
        className="code-resize"
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize code drawer"
        onPointerDown={startResize}
      />
      <header className="code-header">
        <span className="code-path">{file?.path ?? 'Code'}</span>
        <button type="button" className="code-close" aria-label="Close code" onClick={closeCode}>
          <i className="bi bi-x-lg" aria-hidden="true" />
        </button>
      </header>
      <div className="code-body">
        <Body file={file} source={source} reload={reload} />
      </div>
    </section>
  );
}
