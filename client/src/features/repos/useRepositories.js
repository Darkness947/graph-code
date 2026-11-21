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
  /** The last list failure (an ApiError), or null. */
  const [error, setError] = useState(null);
  const alive = useRef(true);
  // Counts local changes (add, retry, remove). A list fetched across a change is stale and dropped,
  // so a poll that left before it cannot undo it; the next poll brings the fresh list.
  const mutations = useRef(0);

  const refresh = useCallback(async () => {
    const started = mutations.current;
    try {
      const data = await listRepos();
      if (!alive.current || mutations.current !== started) return;
      // Keep the same array when a poll brings nothing new, so the grid does not re-render.
      setItems((cur) => (JSON.stringify(cur) === JSON.stringify(data.items) ? cur : data.items));
      setError(null);
    } catch (err) {
      if (!alive.current) return;
      if (!handleUnauthenticated(err)) setError(err);
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
    mutations.current += 1;
    setItems((cur) => [repo, ...(cur ?? []).filter((r) => r.id !== repo.id)]);
  }, []);

  /** Drops a removed repository's card. */
  const remove = useCallback((id) => {
    mutations.current += 1;
    setItems((cur) => (cur ?? []).filter((r) => r.id !== id));
  }, []);

  /** A manual retry after a failed load: clears the error so the spinner shows meanwhile. */
  const reload = useCallback(() => {
    setError(null);
    return refresh();
  }, [refresh]);

  return { items, error, refresh, reload, upsert, remove };
}
