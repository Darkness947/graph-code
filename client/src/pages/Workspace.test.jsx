import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ApiError, request } from '../api/client.js';
import { useWorkspaceStore } from '../store/workspaceStore.js';
import { SAMPLE } from '../../test/graphFixture.js';
import { mockApi, renderApp, USER } from '../../test/helpers.jsx';

vi.mock('../api/client.js', async (importOriginal) => ({
  ...(await importOriginal()),
  request: vi.fn(),
}));

const GRAPH = {
  ...SAMPLE,
  repository: { ...SAMPLE.repository, lastIngestedAt: '2026-11-12T10:00:00Z' },
};
const graphRoute = (answer) => ({ me: USER, routes: { '/repos/repo-1/graph': answer } });
const fail = (status, code, message) => () =>
  Promise.reject(new ApiError(status, { code, message }));

describe('Workspace (spec 8.6)', () => {
  it('shows a spinner while the graph loads', async () => {
    mockApi(graphRoute(() => new Promise(() => {})));
    renderApp('/repos/repo-1');
    expect(await screen.findByText('Loading graph…')).toBeInTheDocument();
  });

  it('draws the header strip and the canvas from the graph', async () => {
    mockApi(graphRoute(() => Promise.resolve(GRAPH)));
    renderApp('/repos/repo-1');

    const crumbs = await screen.findByRole('navigation', { name: 'Breadcrumb' });
    expect(within(crumbs).getByRole('link', { name: 'Dashboard' })).toHaveAttribute(
      'href',
      '/dashboard',
    );
    expect(crumbs).toHaveTextContent('acme/web');
    expect(screen.getByText('Synced 12 Nov 2026')).toBeInTheDocument();
    expect(screen.getByText('7 files · 7 dependencies')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to dashboard' })).toHaveAttribute(
      'href',
      '/dashboard',
    );
    expect(await screen.findByTestId('graph-canvas')).toBeInTheDocument();
    expect(useWorkspaceStore.getState().graph.nodesById.size).toBe(GRAPH.nodes.length);
  });

  it('draws the directory sidebar beside the canvas', async () => {
    mockApi(graphRoute(() => Promise.resolve(GRAPH)));
    renderApp('/repos/repo-1');
    expect(await screen.findByRole('complementary', { name: 'Directory' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Search files' })).toBeInTheDocument();
  });

  it('draws the insights panel and the code drawer handle', async () => {
    mockApi(graphRoute(() => Promise.resolve(GRAPH)));
    renderApp('/repos/repo-1');
    expect(await screen.findByRole('complementary', { name: 'Insights' })).toBeInTheDocument();
    expect(screen.getByText('Click a file to inspect it.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Code/ })).toBeInTheDocument();
  });

  it('explains a graph that is not ready yet', async () => {
    mockApi(graphRoute(fail(409, 'GRAPH_NOT_READY', "This repository's graph isn't ready yet.")));
    renderApp('/repos/repo-1');
    expect(await screen.findByRole('heading', { name: 'Graph not ready yet' })).toBeInTheDocument();
    expect(screen.getByText("This repository's graph isn't ready yet.")).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to dashboard' })).toBeInTheDocument();
  });

  it('shows not found for a repository the user does not own', async () => {
    mockApi(graphRoute(fail(404, 'NOT_FOUND', 'Repository not found.')));
    renderApp('/repos/repo-1');
    expect(
      await screen.findByRole('heading', { name: 'Repository not found' }),
    ).toBeInTheDocument();
  });

  it('offers to try again after an unexpected error', async () => {
    const user = userEvent.setup();
    let calls = 0;
    mockApi(
      graphRoute(() => {
        calls += 1;
        return calls === 1
          ? Promise.reject(new ApiError(500, { code: 'INTERNAL' }))
          : Promise.resolve(GRAPH);
      }),
    );
    renderApp('/repos/repo-1');
    expect(await screen.findByText('Something went wrong. Try again.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByTestId('graph-canvas')).toBeInTheDocument();
    expect(vi.mocked(request)).toHaveBeenCalledWith('/repos/repo-1/graph');
  });

  it('sends the user home when the session expired', async () => {
    mockApi(graphRoute(fail(401, 'UNAUTHENTICATED')));
    renderApp('/repos/repo-1');
    expect(
      await screen.findByText('Your session has expired. Please sign in again.'),
    ).toBeInTheDocument();
  });
});
