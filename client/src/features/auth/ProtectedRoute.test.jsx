import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { mockApi, renderApp, USER } from '../../../test/helpers.jsx';
import { request } from '../../api/client.js';

vi.mock('../../api/client.js', async (importOriginal) => ({
  ...(await importOriginal()),
  request: vi.fn(),
}));

describe('ProtectedRoute (spec 8.2)', () => {
  it('shows a spinner while /api/me is loading', () => {
    mockApi({ me: 'pending' });
    renderApp('/dashboard');

    expect(screen.getByRole('status')).toHaveTextContent('Loading…');
    expect(screen.queryByRole('heading', { name: 'Your Repositories' })).not.toBeInTheDocument();
  });

  it.each(['/dashboard', '/repos/42'])(
    'redirects %s to the landing page with the "Please sign in" toast on 401',
    async (path) => {
      mockApi({ me: null });
      renderApp(path);

      expect(
        await screen.findByRole('heading', { level: 1, name: /See your codebase's architecture/ }),
      ).toBeInTheDocument();
      expect(await screen.findByText('Please sign in')).toBeInTheDocument();
      expect(screen.queryByRole('heading', { name: 'Your Repositories' })).not.toBeInTheDocument();
    },
  );

  it('renders the protected page when signed in', async () => {
    mockApi({ me: USER });
    renderApp('/dashboard');

    expect(await screen.findByRole('heading', { name: 'Your Repositories' })).toBeInTheDocument();
    expect(screen.queryByText('Please sign in')).not.toBeInTheDocument();
  });

  it('sends the user to the error page when the server cannot be reached', async () => {
    mockApi({ me: 'down' });
    renderApp('/dashboard');

    expect(
      await screen.findByRole('heading', { name: 'Something went wrong' }),
    ).toBeInTheDocument();
  });

  it('asks again after a failed session check instead of staying broken', async () => {
    mockApi({ me: 'down' });
    const user = userEvent.setup();
    renderApp('/dashboard');
    await screen.findByRole('heading', { name: 'Something went wrong' });

    vi.mocked(request).mockResolvedValue(USER); // the server is back
    await user.click(screen.getByRole('link', { name: 'Back to home' }));

    // The landing page re-checks the session, finds the user and redirects to the dashboard.
    expect(await screen.findByRole('heading', { name: 'Your Repositories' })).toBeInTheDocument();
  });
});
