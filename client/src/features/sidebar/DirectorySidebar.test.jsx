import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReactFlowProvider } from '@xyflow/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { SAMPLE } from '../../../test/graphFixture.js';
import { useWorkspaceStore } from '../../store/workspaceStore.js';
import DirectorySidebar from './DirectorySidebar.jsx';

const store = () => useWorkspaceStore.getState();

const renderSidebar = () => {
  store().loadGraph(SAMPLE);
  return render(
    <ReactFlowProvider>
      <DirectorySidebar />
    </ReactFlowProvider>,
  );
};
const rows = () =>
  within(screen.getByRole('navigation', { name: 'Files and folders' }))
    .getAllByRole('listitem')
    .map((li) => li.firstElementChild.textContent);

describe('DirectorySidebar (spec 8.6)', () => {
  beforeEach(() => store().reset());

  it('lists folders first, alphabetically, each with its file count', () => {
    renderSidebar();
    expect(rows()).toEqual(['app3', 'src3', 'index.ts']);
  });

  it('expands a folder on the canvas when its name is clicked', async () => {
    const user = userEvent.setup();
    renderSidebar();
    await user.click(screen.getByRole('button', { name: /^src\s*3$/ }));
    expect(store().expandedFolders.has('src')).toBe(true);
    expect(rows()).toEqual(['app3', 'src3', 'lib2', 'main.ts', 'index.ts']);
  });

  it('toggles a folder from its chevron, in both directions', async () => {
    const user = userEvent.setup();
    renderSidebar();
    await user.click(screen.getByRole('button', { name: 'Expand app in the directory' }));
    expect(store().expandedFolders.has('app')).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Collapse app in the directory' }));
    expect(store().expandedFolders.has('app')).toBe(false);
  });

  it('selects a file when it is clicked', async () => {
    const user = userEvent.setup();
    renderSidebar();
    await user.click(screen.getByRole('button', { name: 'index.ts' }));
    expect(store().selectedNodeId).toBe('f:index.ts');
    expect(store().focus.active).toBe(true);
  });

  it('follows the canvas: a selected file opens its folders and is highlighted', () => {
    renderSidebar();
    act(() => store().selectFile('f:src/lib/deep/math.ts'));
    const row = screen.getByRole('button', { name: 'math.ts' });
    expect(row).toHaveAttribute('aria-current', 'true');
    expect(row).toHaveClass('is-selected');
    expect(screen.getByRole('button', { name: 'index.ts' })).not.toHaveAttribute('aria-current');
  });

  it('collapses to a rail and back', async () => {
    const user = userEvent.setup();
    renderSidebar();
    await user.click(screen.getByRole('button', { name: 'Hide directory' }));
    expect(store().sidebarCollapsed).toBe(true);
    expect(screen.queryByRole('navigation', { name: 'Files and folders' })).toBeNull();
    expect(screen.getByRole('complementary', { name: 'Directory' })).toHaveClass('is-rail');
    await user.click(screen.getByRole('button', { name: 'Show directory' }));
    expect(screen.getByRole('navigation', { name: 'Files and folders' })).toBeInTheDocument();
  });
});
