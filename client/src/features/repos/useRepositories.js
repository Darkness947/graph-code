import { useCallback, useEffect, useRef, useState } from 'react';
import { listRepos } from '../../api/repos.js';
import { useSessionStore } from '../auth/useSession.js';
import { showToast } from '../../store/toastStore.js';
import { SESSION_EXPIRED } from './messages.js';

export const POLL_MS = 1500;

/** A repository is still being ingested while pending, analyzing, or its latest job is active. */
export const isAnalyzing = (repo) =>
  repo.status === 'pending' ||
  repo.status === 'analyzing' ||
  repo.latestJob?.status === 'queued' ||
  repo.latestJob?.status === 'running';

/**
 * Ends the session on a mid-session 401 (spec 8.9). ProtectedRoute then redirects to `/`.
 * @returns {boolean} true when the error was a 401
 */
export function handleUnauthenticated(err) {
  if (err?.status !== 401) return false;
  showToast(SESSION_EXPIRED);
  useSessionStore.getState().clear();
  return true;
}

/**
 * The user's repositories. Polls `GET /api/repos` every 1.5 s while any card is analyzing:
 * one request per tick, the next scheduled only after the previous one finishes.
 */
export function useRepositories() {
  const [items, setItems] = useState(null);
  const [error, setError] = useState(false);
  const alive = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const data = await listRepos();
      if (!alive.current) return;
      setItems(data.items);
      setError(false);
    } catch (err) {
      if (!alive.current) return;
      if (!handleUnauthenticated(err)) setError(true);
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    const first = setTimeout(refresh, 0);
    return () => {
      alive.current = false;
      clearTimeout(first);
    };
  }, [refresh]);

  const polling = items?.some(isAnalyzing) ?? false;
  useEffect(() => {
    if (!polling) return undefined;
    const timer = setTimeout(refresh, POLL_MS);
    return () => clearTimeout(timer);
  }, [polling, items, refresh]);

  /** Shows a just-added repository at the top, replacing any older card for it. */
  const upsert = useCallback((repo) => {
    setItems((cur) => [repo, ...(cur ?? []).filter((r) => r.id !== repo.id)]);
  }, []);

  return { items, error, refresh, upsert };
}
