import { screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { mockApi, renderApp, USER } from '../../test/helpers.jsx';

vi.mock('../api/client.js', async (importOriginal) => ({
  ...(await importOriginal()),
  request: vi.fn(),
}));

const main = () => within(screen.getByRole('main'));

describe('Landing (spec 8.4)', () => {
  it('shows the hero with the exact wording, the sign-in link and the placeholder visual', () => {
    mockApi({ me: null });
    renderApp('/');

    expect(
      main().getByRole('heading', {
        level: 1,
        name: "See your codebase's architecture. Predict what breaks before you change it.",
      }),
    ).toBeInTheDocument();
    expect(
      main().getByText(
        'Graph Code turns a GitHub repository into an interactive dependency graph and uses AI to show which files a change will affect.',
      ),
    ).toBeInTheDocument();
    expect(main().getByRole('link', { name: 'Sign in with GitHub' })).toHaveAttribute(
      'href',
      '/api/auth/github',
    );
    expect(main().getByText('Workspace preview')).toBeInTheDocument();
  });

  it('lists the three steps, each with one sentence', () => {
    mockApi({ me: null });
    renderApp('/');

    const steps = main().getAllByRole('listitem');
    expect(steps.map((li) => within(li).getByRole('heading').textContent)).toEqual([
      '1. Connect a repository',
      '2. Explore the graph',
      '3. Predict change impact',
    ]);
    for (const li of steps) expect(li.querySelector('p').textContent).toMatch(/^[^.]+\.$/);
  });

  it('shows the footer', () => {
    mockApi({ me: null });
    renderApp('/');

    const footer = within(screen.getByRole('contentinfo'));
    expect(screen.getByRole('contentinfo')).toHaveTextContent(
      'About · Privacy · © 2026 Graph Code',
    );
    expect(footer.getByRole('link', { name: 'About' })).toHaveAttribute('href', '/about');
    expect(footer.getByRole('link', { name: 'Privacy' })).toHaveAttribute('href', '/privacy');
    expect(
      footer.getByText('Senior Project, Prince Mohammad Bin Fahd University'),
    ).toBeInTheDocument();
  });

  it('redirects a signed-in user to the dashboard', async () => {
    mockApi({ me: USER });
    renderApp('/');

    expect(await screen.findByRole('heading', { name: 'Your Repositories' })).toBeInTheDocument();
  });
});

describe('About and Privacy (spec 8.4)', () => {
  it('renders the About page', () => {
    mockApi({ me: null });
    renderApp('/about');

    expect(main().getByRole('heading', { level: 1, name: 'About Graph Code' })).toBeInTheDocument();
  });

  it('states the four privacy points', () => {
    mockApi({ me: null });
    renderApp('/privacy');

    expect(
      main().getByRole('heading', { level: 1, name: 'Privacy and AI notice' }),
    ).toBeInTheDocument();
    for (const text of [
      'Only public repositories are analyzed in this version.',
      'Source code is never stored; only the graph structure and metadata are stored.',
      "Code excerpts are sent to Google's Gemini API when the user requests an AI analysis, and the free tier allows Google to use submitted content to improve its products.",
      "Users can delete a repository's data at any time.",
    ]) {
      expect(main().getByText(text)).toBeInTheDocument();
    }
  });
});

describe('Error page (spec 8.7)', () => {
  it.each([
    [
      'access_denied',
      'Sign-in was cancelled',
      "You didn't authorize Graph Code on GitHub. No account was created.",
      'Back to home',
      '/',
    ],
    [
      'state_mismatch',
      "Sign-in couldn't be verified",
      'For your security, this sign-in attempt was rejected. Please try again.',
      'Try again',
      '/api/auth/github',
    ],
    [
      'oauth_failed',
      'Sign-in failed',
      "GitHub didn't complete the sign-in. Please try again in a moment.",
      'Try again',
      '/api/auth/github',
    ],
    ['teapot', 'Something went wrong', 'An unexpected error occurred.', 'Back to home', '/'],
    ['toString', 'Something went wrong', 'An unexpected error occurred.', 'Back to home', '/'],
  ])('?code=%s', (code, title, text, action, href) => {
    mockApi({ me: null });
    renderApp(`/error?code=${code}`);

    expect(main().getByRole('heading', { level: 1, name: title })).toBeInTheDocument();
    expect(main().getByText(text)).toBeInTheDocument();
    expect(main().getByRole('link', { name: action })).toHaveAttribute('href', href);
  });

  it('falls back to the generic error without a code', () => {
    mockApi({ me: null });
    renderApp('/error');

    expect(main().getByRole('heading', { name: 'Something went wrong' })).toBeInTheDocument();
  });
});

describe('Not found (spec 8.7)', () => {
  it('reads "Page not found" with links to home and the dashboard', () => {
    mockApi({ me: null });
    renderApp('/no/such/page');

    expect(main().getByRole('heading', { level: 1, name: 'Page not found' })).toBeInTheDocument();
    expect(main().getByRole('link', { name: 'Home' })).toHaveAttribute('href', '/');
    expect(main().getByRole('link', { name: 'Dashboard' })).toHaveAttribute('href', '/dashboard');
  });
});

describe('Routes (spec 8.2)', () => {
  it('serves the graph workspace at /repos/:id when signed in', async () => {
    mockApi({ me: USER });
    renderApp('/repos/42');

    expect(await screen.findByRole('heading', { name: 'Graph workspace' })).toBeInTheDocument();
  });

  it('includes the desktop-screens notice on every page', () => {
    mockApi({ me: null });
    renderApp('/about');

    expect(screen.getByRole('note')).toHaveTextContent(
      'Graph Code is designed for desktop screens.',
    );
  });
});
