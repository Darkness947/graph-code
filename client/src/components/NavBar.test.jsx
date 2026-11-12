import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { mockApi, renderApp, USER } from '../../test/helpers.jsx';
import { request } from '../api/client.js';

vi.mock('../api/client.js', async (importOriginal) => ({
  ...(await importOriginal()),
  request: vi.fn(),
}));

const topBar = () => within(screen.getByRole('banner'));

describe('NavBar (spec 8.3)', () => {
  it('signed out: wordmark to /, About, and a plain sign-in link', async () => {
    mockApi({ me: null });
    renderApp('/about');

    const signIn = await topBar().findByRole('link', { name: 'Sign in with GitHub' });
    expect(signIn).toHaveAttribute('href', '/api/auth/github');
    expect(topBar().getByRole('link', { name: 'Graph Code' })).toHaveAttribute('href', '/');
    expect(topBar().getByRole('link', { name: 'About' })).toHaveAttribute('href', '/about');
    expect(topBar().queryByRole('button', { name: /octocat/ })).not.toBeInTheDocument();
  });

  it('signed in: wordmark to /dashboard, avatar and login, Dashboard and Log out', async () => {
    mockApi({ me: USER });
    const user = userEvent.setup();
    const { container } = renderApp('/about');

    const toggle = await topBar().findByRole('button', { name: /octocat/ });
    expect(topBar().getByRole('link', { name: 'Graph Code' })).toHaveAttribute(
      'href',
      '/dashboard',
    );
    expect(container.querySelector('img.user-avatar')).toHaveAttribute('src', USER.avatarUrl);
    expect(topBar().queryByRole('link', { name: 'Sign in with GitHub' })).not.toBeInTheDocument();

    await user.click(toggle);
    expect(topBar().getByRole('link', { name: 'Dashboard' })).toHaveAttribute('href', '/dashboard');
    expect(topBar().getByRole('button', { name: 'Log out' })).toBeInTheDocument();
  });

  it('Log out posts to the server and returns to the signed-out landing page', async () => {
    mockApi({ me: USER });
    const user = userEvent.setup();
    renderApp('/dashboard');

    await user.click(await topBar().findByRole('button', { name: /octocat/ }));
    await user.click(topBar().getByRole('button', { name: 'Log out' }));

    expect(request).toHaveBeenCalledWith('/auth/logout', { method: 'POST' });
    expect(
      await screen.findByRole('heading', { level: 1, name: /See your codebase's architecture/ }),
    ).toBeInTheDocument();
    expect(topBar().getByRole('link', { name: 'Sign in with GitHub' })).toBeInTheDocument();
    expect(screen.queryByText('Please sign in')).not.toBeInTheDocument();
  });

  it('treats an already-expired session as logged out', async () => {
    mockApi({ me: USER, logout: 'expired' });
    const user = userEvent.setup();
    renderApp('/dashboard');

    await user.click(await topBar().findByRole('button', { name: /octocat/ }));
    await user.click(topBar().getByRole('button', { name: 'Log out' }));

    expect(await topBar().findByRole('link', { name: 'Sign in with GitHub' })).toBeInTheDocument();
    expect(screen.queryByText('Something went wrong. Try again.')).not.toBeInTheDocument();
  });

  it('stays signed in and says so when Log out fails', async () => {
    mockApi({ me: USER, logout: 'fail' });
    const user = userEvent.setup();
    renderApp('/dashboard');

    await user.click(await topBar().findByRole('button', { name: /octocat/ }));
    await user.click(topBar().getByRole('button', { name: 'Log out' }));

    expect(await screen.findByText('Something went wrong. Try again.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Your Repositories' })).toBeInTheDocument();
  });
});
