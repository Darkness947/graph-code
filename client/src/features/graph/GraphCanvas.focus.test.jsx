import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SAMPLE } from '../../../test/graphFixture.js';
import { request } from '../../api/client.js';
import { useWorkspaceStore } from '../../store/workspaceStore.js';
import GraphCanvas from './GraphCanvas.jsx';

const view = vi.hoisted(() => ({ fitBounds: vi.fn(), fitView: vi.fn() }));

vi.mock('../../api/client.js', () => ({ request: vi.fn() }));
vi.mock('@xyflow/react', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    useReactFlow: () => ({
      ...actual.useReactFlow(),
      fitBounds: view.fitBounds,
      fitView: view.fitView,
    }),
  };
});

const store = () => useWorkspaceStore.getState();
const nodeEl = (id) => document.querySelector(`.react-flow__node[data-id="${id}"]`);
const BACK = '← Back to full graph';

async function renderCanvas(expanded = ['src/lib/deep', 'app/blog']) {
  store().loadGraph(SAMPLE);
  for (const path of expanded) store().expandFolder(path);
  render(
    <div style={{ width: 1280, height: 720 }}>
      <GraphCanvas />
    </div>,
  );
  await screen.findByTestId('graph-canvas');
}

describe('GraphCanvas focus mode (spec 8.6 item 8)', () => {
  beforeEach(() => {
    store().reset();
    view.fitBounds.mockClear();
    view.fitView.mockClear();
    vi.mocked(request).mockClear();
    vi.stubGlobal('matchMedia', (query) => ({ matches: query.includes('reduce') }));
  });

  it('selects a clicked file: blue border, neighbourhood lit, the rest dimmed, view fitted', async () => {
    await renderCanvas();
    fireEvent.click(nodeEl('f:src/lib/utils.ts'));

    expect(store().selectedNodeId).toBe('f:src/lib/utils.ts');
    expect(store().focus.active).toBe(true);
    expect(nodeEl('f:src/lib/utils.ts')).toHaveClass('is-selected');
    expect(nodeEl('f:src/main.ts')).not.toHaveClass('is-dim');
    expect(nodeEl('f:src/lib/deep/math.ts')).not.toHaveClass('is-dim');
    expect(nodeEl('f:app/layout.tsx')).toHaveClass('is-dim');
    expect(view.fitBounds).toHaveBeenCalledTimes(1);
    expect(vi.mocked(request)).not.toHaveBeenCalled();
  });

  it('shows the back pill only in focus mode and exits from it', async () => {
    const user = userEvent.setup();
    await renderCanvas();
    expect(screen.queryByRole('button', { name: BACK })).toBeNull();

    fireEvent.click(nodeEl('f:src/lib/utils.ts'));
    await user.click(screen.getByRole('button', { name: BACK }));

    expect(store().focus.active).toBe(false);
    expect(store().selectedNodeId).toBeNull();
    expect(nodeEl('f:app/layout.tsx')).not.toHaveClass('is-dim');
    expect(view.fitView).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: BACK })).toBeNull();
  });

  it('exits focus mode on Escape and fits the whole graph', async () => {
    await renderCanvas();
    fireEvent.click(nodeEl('f:src/lib/utils.ts'));
    fireEvent.keyDown(document.body, { key: 'Escape' });

    expect(store().focus.active).toBe(false);
    expect(view.fitView).toHaveBeenCalledTimes(1);
  });

  it('keeps focus mode when Escape only clears the search', async () => {
    const user = userEvent.setup();
    await renderCanvas();
    fireEvent.click(nodeEl('f:src/lib/utils.ts'));
    await user.type(screen.getByRole('combobox', { name: 'Search files' }), 'page{Escape}');

    expect(store().focus.active).toBe(true);
    expect(store().search.query).toBe('');
  });

  it('lights a collapsed folder that holds a neighbour and leaves it collapsed', async () => {
    await renderCanvas([]);
    act(() => store().selectFile('f:index.ts'));
    expect(nodeEl('d:src')).not.toHaveClass('is-dim');
    expect(nodeEl('d:app')).not.toHaveClass('is-dim');
    expect(store().expandedFolders.size).toBe(0);
  });

  it('dims the edges outside the neighbourhood', async () => {
    await renderCanvas([]);
    act(() => store().selectFile('f:index.ts'));
    const dimmed = [...document.querySelectorAll('.react-flow__edge .gc-edge.is-dim')];
    expect(dimmed.length).toBeLessThan(document.querySelectorAll('.react-flow__edge').length);
  });

  it('ignores a click on a folder', async () => {
    await renderCanvas([]);
    fireEvent.click(nodeEl('d:src'));
    expect(store().focus.active).toBe(false);
  });
});
