import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi } from 'vitest';
import { ApiError, request } from '../src/api/client.js';
import { useSessionStore } from '../src/features/auth/useSession.js';
import AppRoutes from '../src/routes.jsx';
import { dismissToast } from '../src/store/toastStore.js';

export const USER = {
  id: 'b7c1b0de-0000-4000-8000-000000000001',
  login: 'octocat',
  avatarUrl: 'https://avatars.githubusercontent.com/u/583231',
  aiNoticeAcknowledged: false,
};

/**
 * Starts a test from a fresh session and sets what the mocked `request` answers.
 * The test file must mock `api/client.js` so that `request` is a `vi.fn()` and `ApiError`
 * stays real.
 * @param {{ me?: object | null | 'pending' | 'down', logout?: 'ok' | 'fail' | 'expired' }} [options]
 *   `me`: a user object (signed in), `null` (401), `'pending'` (never answers) or `'down'`.
 */
export function mockApi({ me = null, logout = 'ok' } = {}) {
  useSessionStore.setState({ status: 'idle', user: null });
  dismissToast();
  vi.mocked(request).mockImplementation((path) => {
    if (path === '/me') {
      if (me === 'pending') return new Promise(() => {});
      if (me === 'down') return Promise.reject(new ApiError(0));
      if (me === null) {
        return Promise.reject(
          new ApiError(401, { code: 'UNAUTHENTICATED', message: 'Sign in to continue.' }),
        );
      }
      return Promise.resolve(me);
    }
    if (path === '/auth/logout') {
      if (logout === 'ok') return Promise.resolve(null);
      return Promise.reject(
        logout === 'expired'
          ? new ApiError(401, { code: 'UNAUTHENTICATED' })
          : new ApiError(500, { code: 'INTERNAL' }),
      );
    }
    return Promise.reject(new ApiError(404, { code: 'NOT_FOUND' }));
  });
}

/** Renders the whole route table at `path`. */
export function renderApp(path = '/') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AppRoutes />
    </MemoryRouter>,
  );
}
