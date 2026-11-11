import { useEffect } from 'react';
import { create } from 'zustand';
import { getMe, logout } from '../../api/auth.js';

/**
 * Session status:
 * - `idle`: not asked yet
 * - `loading`: waiting for `GET /api/me`
 * - `authenticated`: `user` is set
 * - `anonymous`: the server answered 401
 * - `error`: the server could not be asked (network failure or a server error)
 */
const initialState = { status: 'idle', user: null };

export const useSessionStore = create((set, get) => ({
  ...initialState,

  /** Asks the server who is signed in. Runs once; later callers share the answer. */
  async load() {
    if (get().status !== 'idle') return;
    set({ status: 'loading' });
    try {
      set({ status: 'authenticated', user: await getMe() });
    } catch (err) {
      set({ status: err.status === 401 ? 'anonymous' : 'error', user: null });
    }
  },

  /** Destroys the session on the server, then forgets the user. Throws if the server refuses. */
  async signOut() {
    await logout();
    set({ status: 'anonymous', user: null });
  },

  reset: () => set(initialState),
}));

/**
 * The current session, loaded on first use and shared by every component.
 * @returns {{ status: string, user: object | null, isLoading: boolean, isSignedIn: boolean }}
 */
export function useSession() {
  const status = useSessionStore((s) => s.status);
  const user = useSessionStore((s) => s.user);
  const load = useSessionStore((s) => s.load);

  useEffect(() => {
    load();
  }, [load]);

  return {
    status,
    user,
    isLoading: status === 'idle' || status === 'loading',
    isSignedIn: status === 'authenticated',
  };
}
