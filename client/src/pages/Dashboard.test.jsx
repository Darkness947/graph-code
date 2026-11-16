import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api/client.js';
import { mockApi, renderApp, USER } from '../../test/helpers.jsx';

vi.mock('../api/client.js', async (importOriginal) => ({
  ...(await importOriginal()),
  request: vi.fn(),
}));

const job = (over = {}) => ({
  id: 'j1',
  status: 'running',
  phase: 'parsing',
  filesTotal: 340,
  filesProcessed: 142,
  filesSkipped: 0,
  errorCode: null,
  errorMessage: null,
  report: null,
  ...over,
});

const repo = (over = {}) => ({
  id: 'r1',
  owner: 'vercel',
  name: 'next-learn',
  displayName: 'vercel/next-learn',
  status: 'ready',
  fileCount: 214,
  edgeCount: 388,
  languageSummary: { ts: 180, tsx: 34 },
  lastIngestedAt: '2026-11-12T10:00:00Z',
  ingestionMs: 9000,
  latestJob: job({ status: 'succeeded', phase: null }),
  ...over,
});

const reposRoute = (items) => ({ '/repos': () => Promise.resolve({ items }) });
const apiErr = (status, error) => Promise.reject(new ApiError(status, error));
const URL_PLACEHOLDER = 'owner/name or https://github.com/owner/name';

afterEach(() => vi.useRealTimers());

describe('Dashboard (spec 8.5)', () => {
  it('shows the empty state and opens the analyze modal from its button', async () => {
    mockApi({
      me: USER,
      routes: {
        ...reposRoute([]),
        '/github/repos?page=1': () => Promise.resolve({ items: [], nextPage: null }),
      },
    });
    const user = userEvent.setup();
    renderApp('/dashboard');

    expect(
      await screen.findByRole('heading', { name: 'Analyze your first repository' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'Pick one of your public repositories or paste any public GitHub repository.',
      ),
    ).toBeInTheDocument();
    const buttons = screen.getAllByRole('button', { name: 'Analyze a repository' });
    await user.click(buttons[buttons.length - 1]);
    expect(await screen.findByRole('tab', { name: 'From your GitHub' })).toBeInTheDocument();
    expect(
      await screen.findByText('No public repositories found on your GitHub account.'),
    ).toBeInTheDocument();
  });

  it('renders a ready card with its counts, badge, languages and enabled Open graph', async () => {
    mockApi({ me: USER, routes: reposRoute([repo()]) });
    renderApp('/dashboard');

    const card = await screen.findByRole('article', { name: 'vercel/next-learn' });
    expect(within(card).getByText('Ready')).toBeInTheDocument();
    expect(within(card).getByText('ts')).toBeInTheDocument();
    expect(card).toHaveTextContent('214 files · 388 dependencies · synced 12 Nov 2026');
    expect(within(card).getByRole('link', { name: 'Open graph' })).toHaveAttribute(
      'href',
      '/repos/r1',
    );
    expect(within(card).getByRole('button', { name: 'Remove repository' })).toBeEnabled();
  });

  it('shows the skipped-files line on a ready card', async () => {
    mockApi({
      me: USER,
      routes: reposRoute([repo({ latestJob: job({ status: 'succeeded', filesSkipped: 3 }) })]),
    });
    renderApp('/dashboard');
    expect(
      await screen.findByText("3 file(s) couldn't be parsed and were skipped."),
    ).toBeInTheDocument();
  });

  it.each([
    ['fetching', 'Downloading repository…'],
    ['extracting', 'Extracting files…'],
    ['parsing', 'Parsing 142 / 340 files…'],
    ['resolving', 'Resolving imports…'],
    ['persisting', 'Saving graph…'],
  ])('shows the progress label for the %s phase', async (phase, label) => {
    mockApi({
      me: USER,
      routes: reposRoute([repo({ status: 'analyzing', latestJob: job({ phase }) })]),
    });
    renderApp('/dashboard');

    const card = await screen.findByRole('article', { name: 'vercel/next-learn' });
    expect(within(card).getByText(label)).toBeInTheDocument();
    expect(within(card).getByText('Analyzing')).toBeInTheDocument();
    expect(
      within(card).getByText('Large repository. This can take up to a minute.'),
    ).toBeInTheDocument();
    expect(within(card).getByRole('button', { name: 'Open graph' })).toBeDisabled();
    expect(within(card).getByRole('button', { name: 'Remove repository' })).toBeDisabled();
  });

  it('polls while analyzing, switches the card to ready, then stops polling', async () => {
    const analyzing = repo({ status: 'analyzing', latestJob: job() });
    let calls = 0;
    mockApi({
      me: USER,
      routes: {
        '/repos': () => {
          calls += 1;
          return Promise.resolve({ items: [calls < 3 ? analyzing : repo()] });
        },
      },
    });
    vi.useFakeTimers({ shouldAdvanceTime: true });
    renderApp('/dashboard');

    expect(await screen.findByText('Parsing 142 / 340 files…')).toBeInTheDocument();
    await act(() => vi.advanceTimersByTimeAsync(1500));
    await act(() => vi.advanceTimersByTimeAsync(1500));
    expect(await screen.findByText('Ready')).toBeInTheDocument();
    expect(calls).toBe(3);

    await act(() => vi.advanceTimersByTimeAsync(10000));
    expect(calls).toBe(3);
  });

  it('shows the failed card with the job message and retries with the same repository', async () => {
    const message =
      'This repository has more than 1,000 JavaScript/TypeScript files, which is above the current limit.';
    const failed = repo({
      status: 'failed',
      latestJob: job({ status: 'failed', errorCode: 'REPO_TOO_LARGE', errorMessage: message }),
    });
    const started = repo({ status: 'analyzing', latestJob: job() });
    const post = vi.fn(() => Promise.resolve({ repository: started, job: started.latestJob }));
    mockApi({
      me: USER,
      routes: {
        '/repos': (o) => (o?.method === 'POST' ? post(o) : Promise.resolve({ items: [failed] })),
      },
    });
    const user = userEvent.setup();
    renderApp('/dashboard');

    const card = await screen.findByRole('article', { name: 'vercel/next-learn' });
    expect(within(card).getByText('Failed')).toBeInTheDocument();
    expect(within(card).getByText(message)).toBeInTheDocument();
    await user.click(within(card).getByRole('button', { name: 'Try again' }));
    expect(post).toHaveBeenCalledWith({ method: 'POST', body: { repo: 'vercel/next-learn' } });
    expect(await screen.findByText('Analyzing')).toBeInTheDocument();
  });

  it('a poll that started before Try again does not undo the retry', async () => {
    const failed = repo({
      status: 'failed',
      latestJob: job({ status: 'failed', errorCode: 'INTERNAL', errorMessage: 'Boom.' }),
    });
    const other = repo({
      id: 'r2',
      owner: 'acme',
      name: 'tools',
      displayName: 'acme/tools',
      status: 'analyzing',
      latestJob: job({ id: 'j2' }),
    });
    const started = repo({ status: 'analyzing', latestJob: job({ id: 'j3' }) });
    let release;
    let calls = 0;
    mockApi({
      me: USER,
      routes: {
        '/repos': (o) => {
          if (o?.method === 'POST')
            return Promise.resolve({ repository: started, job: started.latestJob });
          calls += 1;
          if (calls === 1) return Promise.resolve({ items: [failed, other] });
          return new Promise((r) => {
            release = () => r({ items: [failed, other] });
          });
        },
      },
    });
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderApp('/dashboard');

    const card = await screen.findByRole('article', { name: 'vercel/next-learn' });
    await act(() => vi.advanceTimersByTimeAsync(1500));
    expect(calls).toBe(2);
    await user.click(within(card).getByRole('button', { name: 'Try again' }));
    await waitFor(() =>
      expect(
        within(screen.getByRole('article', { name: 'vercel/next-learn' })).getByText('Analyzing'),
      ).toBeInTheDocument(),
    );
    await act(async () => release());
    const after = screen.getByRole('article', { name: 'vercel/next-learn' });
    expect(within(after).getByText('Analyzing')).toBeInTheDocument();
    expect(within(after).queryByText('Boom.')).not.toBeInTheDocument();
  });

  it('filters cards client-side', async () => {
    mockApi({
      me: USER,
      routes: reposRoute([
        repo(),
        repo({ id: 'r2', owner: 'acme', name: 'tools', displayName: 'acme/tools' }),
      ]),
    });
    const user = userEvent.setup();
    renderApp('/dashboard');
    await screen.findByRole('article', { name: 'acme/tools' });

    await user.type(screen.getByRole('searchbox', { name: 'Filter repositories' }), 'acme');
    expect(screen.queryByRole('article', { name: 'vercel/next-learn' })).not.toBeInTheDocument();
    expect(screen.getByRole('article', { name: 'acme/tools' })).toBeInTheDocument();
  });

  it('sends the user home with the expired-session toast on a mid-session 401', async () => {
    mockApi({
      me: USER,
      routes: { '/repos': () => apiErr(401, { code: 'UNAUTHENTICATED' }) },
    });
    renderApp('/dashboard');

    expect(
      await screen.findByText('Your session has expired. Please sign in again.'),
    ).toBeInTheDocument();
    expect(
      await screen.findByRole('heading', { level: 1, name: /See your codebase's architecture/ }),
    ).toBeInTheDocument();
  });
});

describe('Remove repository (spec 8.5)', () => {
  const CONFIRM =
    'Remove vercel/next-learn? This deletes its dependency graph and cached AI results from Graph Code. Your repository on GitHub is not affected.';

  /** Routes `GET /repos` to `items` and `DELETE /repos/r1` to `onDelete`. */
  const routes = (items, onDelete) => ({
    ...reposRoute(items),
    '/repos/r1': (o) => (o?.method === 'DELETE' ? onDelete(o) : apiErr(404, {})),
  });

  async function openModal(user) {
    const card = await screen.findByRole('article', { name: 'vercel/next-learn' });
    await user.click(within(card).getByRole('button', { name: 'Remove repository' }));
    return screen.findByRole('dialog');
  }

  it('confirms with the exact text; Cancel closes without deleting', async () => {
    const onDelete = vi.fn();
    mockApi({ me: USER, routes: routes([repo()], onDelete) });
    const user = userEvent.setup();
    renderApp('/dashboard');

    const dialog = await openModal(user);
    expect(dialog).toHaveAccessibleName(CONFIRM);
    expect(within(dialog).getByText(CONFIRM)).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Remove' })).toHaveClass(
      'btn-danger-outline',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(onDelete).not.toHaveBeenCalled();
    expect(screen.getByRole('article', { name: 'vercel/next-learn' })).toBeInTheDocument();
  });

  it('removes: sends DELETE, the card disappears and the toast says "Repository removed"', async () => {
    const onDelete = vi.fn(() => Promise.resolve(null));
    const other = repo({ id: 'r2', owner: 'acme', name: 'tools', displayName: 'acme/tools' });
    mockApi({ me: USER, routes: routes([repo(), other], onDelete) });
    const user = userEvent.setup();
    renderApp('/dashboard');

    const dialog = await openModal(user);
    await user.click(within(dialog).getByRole('button', { name: 'Remove' }));
    expect(onDelete).toHaveBeenCalledExactlyOnceWith({ method: 'DELETE' });
    expect(await screen.findByText('Repository removed')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.queryByRole('article', { name: 'vercel/next-learn' })).not.toBeInTheDocument();
    expect(screen.getByRole('article', { name: 'acme/tools' })).toBeInTheDocument();
  });

  it('shows the JOB_ACTIVE message inline and keeps the card', async () => {
    mockApi({
      me: USER,
      routes: routes([repo()], () =>
        apiErr(409, { code: 'JOB_ACTIVE', message: 'x', jobId: 'j9' }),
      ),
    });
    const user = userEvent.setup();
    renderApp('/dashboard');

    const dialog = await openModal(user);
    await user.click(within(dialog).getByRole('button', { name: 'Remove' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'This repository is already being analyzed.',
    );
    expect(screen.getByRole('article', { name: 'vercel/next-learn' })).toBeInTheDocument();
    expect(screen.queryByText('Repository removed')).not.toBeInTheDocument();
  });

  it('shows the generic message inline on any other failure', async () => {
    mockApi({ me: USER, routes: routes([repo()], () => apiErr(500, { code: 'INTERNAL' })) });
    const user = userEvent.setup();
    renderApp('/dashboard');

    const dialog = await openModal(user);
    await user.click(within(dialog).getByRole('button', { name: 'Remove' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Something went wrong. Try again.',
    );
  });

  it('disables Remove while analyzing, with the tooltip "Wait for analysis to finish"', async () => {
    mockApi({ me: USER, routes: reposRoute([repo({ status: 'analyzing', latestJob: job() })]) });
    const user = userEvent.setup();
    renderApp('/dashboard');

    const card = await screen.findByRole('article', { name: 'vercel/next-learn' });
    const button = within(card).getByRole('button', { name: 'Remove repository' });
    expect(button).toBeDisabled();
    await user.hover(button.parentElement);
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Wait for analysis to finish');
  });

  it('a poll that started before the delete does not bring the card back', async () => {
    const analyzing = repo({
      id: 'r2',
      owner: 'acme',
      name: 'tools',
      displayName: 'acme/tools',
      status: 'analyzing',
      latestJob: job(),
    });
    let release;
    let calls = 0;
    mockApi({
      me: USER,
      routes: {
        '/repos': () => {
          calls += 1;
          if (calls === 1) return Promise.resolve({ items: [repo(), analyzing] });
          // The second poll is in flight while the user removes the card.
          return new Promise((r) => {
            release = () => r({ items: [repo(), analyzing] });
          });
        },
        '/repos/r1': () => Promise.resolve(null),
      },
    });
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderApp('/dashboard');

    const dialog = await openModal(user);
    await act(() => vi.advanceTimersByTimeAsync(1500));
    expect(calls).toBe(2);
    await user.click(within(dialog).getByRole('button', { name: 'Remove' }));
    expect(await screen.findByText('Repository removed')).toBeInTheDocument();
    await act(async () => release());
    expect(screen.queryByRole('article', { name: 'vercel/next-learn' })).not.toBeInTheDocument();
    expect(screen.getByRole('article', { name: 'acme/tools' })).toBeInTheDocument();
  });
});

describe('Analyze modal (spec 8.5)', () => {
  const ghItem = (n, over = {}) => ({
    owner: 'octocat',
    name: `r${n}`,
    fullName: `octocat/r${n}`,
    description: `desc ${n}`,
    language: 'TypeScript',
    defaultBranch: 'main',
    updatedAt: '2026-11-01T00:00:00Z',
    alreadyAdded: false,
    ...over,
  });
  const emptyGithub = {
    '/github/repos?page=1': () => Promise.resolve({ items: [], nextPage: null }),
  };

  async function openModal(routes) {
    mockApi({ me: USER, routes: { ...reposRoute([repo()]), ...routes } });
    const user = userEvent.setup();
    renderApp('/dashboard');
    await screen.findByRole('article', { name: 'vercel/next-learn' });
    await user.click(screen.getByRole('button', { name: 'Analyze a repository' }));
    return user;
  }

  async function submitUrl(user, text) {
    await user.click(await screen.findByRole('tab', { name: 'Any public repository' }));
    await user.type(screen.getByPlaceholderText(URL_PLACEHOLDER), `${text}{Enter}`);
  }

  it('lists GitHub repositories, marks added ones and pages with Load more', async () => {
    const pages = {
      1: { items: [ghItem(1), ghItem(2, { alreadyAdded: true })], nextPage: 2 },
      2: { items: [ghItem(3)], nextPage: null },
    };
    const user = await openModal({
      '/github/repos?page=1': () => Promise.resolve(pages[1]),
      '/github/repos?page=2': () => Promise.resolve(pages[2]),
    });

    expect(await screen.findByText('octocat/r1')).toBeInTheDocument();
    expect(screen.getByText('Already added')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Load more' }));
    expect(await screen.findByText('octocat/r3')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
  });

  it('shows the load error with Retry that loads again', async () => {
    let n = 0;
    const user = await openModal({
      '/github/repos?page=1': () => {
        n += 1;
        return n === 1
          ? apiErr(502, { code: 'GITHUB_UNAVAILABLE' })
          : Promise.resolve({ items: [ghItem(1)], nextPage: null });
      },
    });

    expect(
      await screen.findByText("Couldn't load your repositories from GitHub."),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('octocat/r1')).toBeInTheDocument();
  });

  it('adds from the list: the modal closes and the new card is first', async () => {
    const added = repo({
      id: 'r9',
      owner: 'octocat',
      name: 'r1',
      displayName: 'octocat/r1',
      status: 'analyzing',
      latestJob: job({ phase: 'fetching', filesTotal: null }),
    });
    const user = await openModal({
      '/github/repos?page=1': () => Promise.resolve({ items: [ghItem(1)], nextPage: null }),
      '/repos': (o) =>
        o?.method === 'POST'
          ? Promise.resolve({ repository: added, job: added.latestJob })
          : Promise.resolve({ items: [repo()] }),
    });
    await user.click(await screen.findByRole('button', { name: 'Analyze octocat/r1' }));

    await waitFor(() => expect(screen.queryByRole('tab')).not.toBeInTheDocument());
    expect(screen.getAllByRole('article')[0]).toHaveAccessibleName('octocat/r1');
  });

  it('keeps Analyze disabled until the input parses', async () => {
    const user = await openModal(emptyGithub);
    await user.click(await screen.findByRole('tab', { name: 'Any public repository' }));
    const input = screen.getByPlaceholderText(URL_PLACEHOLDER);
    const button = input.closest('form').querySelector('button[type="submit"]');

    expect(button).toBeDisabled();
    await user.type(input, 'not a repo');
    expect(button).toBeDisabled();
    await user.clear(input);
    await user.type(input, 'octocat/hello');
    expect(button).toBeEnabled();
  });

  it.each([
    [400, { code: 'VALIDATION_ERROR' }, 'Enter a repository as owner/name or a github.com link.'],
    [
      404,
      { code: 'REPO_NOT_FOUND_ON_GITHUB' },
      "We couldn't find that repository on GitHub. Check the owner and name.",
    ],
    [
      422,
      { code: 'REPO_PRIVATE_NOT_SUPPORTED' },
      'This repository is private. Only public repositories are supported in this version.',
    ],
    [409, { code: 'JOB_ACTIVE' }, 'This repository is already being analyzed.'],
    [
      429,
      { code: 'RATE_LIMITED', retryAfterSeconds: 30 },
      "You're doing that too often. Try again in 30 seconds.",
    ],
    [
      502,
      { code: 'GITHUB_UNAVAILABLE' },
      "GitHub isn't responding right now. Try again in a moment.",
    ],
    [500, { code: 'INTERNAL' }, 'Something went wrong. Try again.'],
  ])('shows the inline error for %s %j', async (status, error, message) => {
    const user = await openModal({
      ...emptyGithub,
      '/repos': (o) =>
        o?.method === 'POST' ? apiErr(status, error) : Promise.resolve({ items: [repo()] }),
    });
    await submitUrl(user, 'octocat/hello');

    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    expect(screen.getByRole('tab', { name: 'Any public repository' })).toBeInTheDocument();
  });

  it('offers an Open graph link on REPO_ALREADY_ANALYZED', async () => {
    const user = await openModal({
      ...emptyGithub,
      '/repos': (o) =>
        o?.method === 'POST'
          ? apiErr(409, { code: 'REPO_ALREADY_ANALYZED', repositoryId: 'abc' })
          : Promise.resolve({ items: [repo()] }),
    });
    await submitUrl(user, 'octocat/hello');

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent("You've already analyzed this repository.");
    expect(within(alert).getByRole('link', { name: 'Open graph' })).toHaveAttribute(
      'href',
      '/repos/abc',
    );
  });
});
