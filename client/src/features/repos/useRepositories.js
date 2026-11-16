import { useCallback, useEffect, useRef, useState } from 'react';
import { addRepo, listRepos } from '../../api/repos.js';
import { useSessionStore } from '../auth/useSession.js';
import { showToast } from '../../store/toastStore.js';
import { addErrorMessage, SESSION_EXPIRED } from './messages.js';

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
 * Adds a repository (or retries a failed one), handling a mid-session 401 once for every caller.
 * @param {string} repo `owner/name` or a github.com URL
 * @returns {Promise<{ repository?: object, error?: { code: string, message: string, repositoryId?: string } }>}
 *   `{}` when the session expired (the user is already being sent home)
 */
export async function tryAddRepo(repo) {
  try {
    const { repository } = await addRepo(repo);
    return { repository };
  } catch (err) {
    if (handleUnauthenticated(err)) return {};
    return {
      error: { code: err.code, message: addErrorMessage(err), repositoryId: err.repositoryId },
    };
  }
}

/**
 * The user's repositories. Polls `GET /api/repos` every 1.5 s while any card is analyzing:
 * one request per tick, the next scheduled only after the previous one finishes.
 */
export function useRepositories() {
  const [items, setItems] = useState(null);
  const [error, setError] = useState(false);
  const alive = useRef(true);
  // Ids removed in this view: a poll that left before the delete must not bring them back.
  const removed = useRef(new Set());

  const refresh = useCallback(async () => {
    try {
      const data = await listRepos();
      if (!alive.current) return;
      const next = data.items.filter((r) => !removed.current.has(r.id));
      // Keep the same array when a poll brings nothing new, so the grid does not re-render.
      setItems((cur) => (JSON.stringify(cur) === JSON.stringify(next) ? cur : next));
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
  // Each tick waits for the previous request, then schedules the next one.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!polling) return undefined;
    const timer = setTimeout(async () => {
      await refresh();
      if (alive.current) setTick((t) => t + 1);
    }, POLL_MS);
    return () => clearTimeout(timer);
  }, [polling, tick, refresh]);

  /** Shows a just-added repository at the top, replacing any older card for it. */
  const upsert = useCallback((repo) => {
    setItems((cur) => [repo, ...(cur ?? []).filter((r) => r.id !== repo.id)]);
  }, []);

  /** Drops a removed repository's card and keeps it out of later polls. */
  const remove = useCallback((id) => {
    removed.current.add(id);
    setItems((cur) => (cur ?? []).filter((r) => r.id !== id));
  }, []);

  return { items, error, refresh, upsert, remove };
}
