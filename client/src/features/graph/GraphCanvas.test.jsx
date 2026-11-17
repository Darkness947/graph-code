import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SAMPLE } from '../../../test/graphFixture.js';
import { useWorkspaceStore } from '../../store/workspaceStore.js';
import GraphCanvas, { changedFolder } from './GraphCanvas.jsx';
import { LAYOUT_FAILED } from './GraphFallbackList.jsx';
import * as layoutModule from './layout.js';

vi.mock('./layout.js', { spy: true });

const store = () => useWorkspaceStore.getState();
const nodeEl = (id) => document.querySelector(`.react-flow__node[data-id="${id}"]`);
const edgeEl = (id) => document.querySelector(`.react-flow__edge[data-id="${id}"]`);

async function renderCanvas(expanded = []) {
  store().loadGraph(SAMPLE);
  for (const path of expanded) store().expandFolder(path);
  const view = render(
    <div style={{ width: 1280, height: 720 }}>
      <GraphCanvas />
    </div>,
  );
  await screen.findByTestId('graph-canvas');
  return view;
}

describe('GraphCanvas', () => {
  beforeEach(() => {
    store().reset();
    // Layout changes apply at once under reduced motion; the motion itself is tested in
    // useAnimatedNodes.test.jsx.
    vi.stubGlobal('matchMedia', (query) => ({ matches: query.includes('reduce') }));
  });

  afterEach(() => vi.unstubAllGlobals());

  it('starts with every top-level folder collapsed, showing name, count and a chevron', async () => {
    await renderCanvas();
    const src = nodeEl('d:src');
    expect(src).toHaveTextContent('src');
    expect(src).toHaveTextContent('3 files');
    expect(within(src).getByRole('button', { name: 'Expand folder src' })).toBeInTheDocument();
    expect(nodeEl('d:src/lib')).toBeNull();
    expect(nodeEl('f:index.ts')).toHaveTextContent('index.ts');
  });

  it('expands a folder from its chevron and collapses it again', async () => {
    const user = userEvent.setup();
    await renderCanvas();
    await user.click(screen.getByRole('button', { name: 'Expand folder src' }));

    expect(store().expandedFolders.has('src')).toBe(true);
    expect(await screen.findByRole('button', { name: 'Collapse folder src' })).toBeInTheDocument();
    expect(nodeEl('d:src/lib')).toHaveTextContent('lib');

    await user.click(screen.getByRole('button', { name: 'Collapse folder src' }));
    expect(store().expandedFolders.has('src')).toBe(false);
  });

  it('expands a collapsed folder on double-click', async () => {
    await renderCanvas();
    fireEvent.doubleClick(nodeEl('d:app'));
    expect(store().expandedFolders.has('app')).toBe(true);
  });

  it('shows a file name, its parent hint and its counters', async () => {
    await renderCanvas(['src', 'src/lib']);
    const utils = nodeEl('f:src/lib/utils.ts');
    expect(utils).toHaveTextContent('utils.ts · src/lib');
    expect(utils).toHaveTextContent('imports 1 · used by 3');
  });

  it('draws aggregated edges with a count badge that expands the target folder', async () => {
    const user = userEvent.setup();
    await renderCanvas();
    const badge = await screen.findByRole('button', { name: '2 imports. Expand folder src' });
    expect(badge).toHaveTextContent('2');

    await user.click(badge);
    expect(store().expandedFolders.has('src')).toBe(true);
  });

  it('raises the edges of the hovered node without running layout again', async () => {
    await renderCanvas();
    const calls = vi.mocked(layoutModule.layoutGraph).mock.calls.length;
    const path = () => edgeEl('f:index.ts->d:src').querySelector('.gc-edge');
    expect(path()).not.toHaveClass('is-active');

    act(() => store().setHovered('f:index.ts'));
    expect(path()).toHaveClass('is-active');
    expect(edgeEl('d:app->d:src').querySelector('.gc-edge')).not.toHaveClass('is-active');

    act(() => store().setHovered(null));
    expect(path()).not.toHaveClass('is-active');
    expect(vi.mocked(layoutModule.layoutGraph).mock.calls.length).toBe(calls);
  });

  it('sets the hovered node from the pointer', async () => {
    await renderCanvas();
    fireEvent.mouseEnter(nodeEl('f:index.ts'));
    expect(store().hoveredNodeId).toBe('f:index.ts');
    fireEvent.mouseLeave(nodeEl('f:index.ts'));
    expect(store().hoveredNodeId).toBeNull();
  });

  it('shows zoom controls and a minimap', async () => {
    await renderCanvas();
    expect(document.querySelector('.react-flow__controls')).toBeInTheDocument();
    expect(document.querySelector('.react-flow__minimap')).toBeInTheDocument();
  });

  it('falls back to a file list when layout throws', async () => {
    vi.mocked(layoutModule.layoutGraph).mockImplementationOnce(() => {
      throw new Error('boom');
    });
    store().loadGraph(SAMPLE);
    render(<GraphCanvas />);

    expect(screen.getByRole('alert')).toHaveTextContent(LAYOUT_FAILED);
    const rows = screen.getAllByRole('row');
    expect(rows).toHaveLength(1 + SAMPLE.nodes.filter((n) => n.type === 'file').length);
    const utils = rows.find((r) => r.textContent.startsWith('src/lib/utils.ts'));
    expect(
      within(utils)
        .getAllByRole('cell')
        .map((c) => c.textContent),
    ).toEqual(['src/lib/utils.ts', '1', '3']);
    expect(screen.queryByTestId('graph-canvas')).toBeNull();
  });
});

describe('changedFolder', () => {
  it('names the folder that was expanded or collapsed', () => {
    expect(changedFolder(new Set(), new Set(['src']))).toBe('src');
    expect(changedFolder(new Set(['src', 'app']), new Set(['app']))).toBe('src');
  });

  it('picks the deepest folder when ancestors open with it', () => {
    expect(changedFolder(new Set(), new Set(['src', 'src/lib', 'src/lib/deep']))).toBe(
      'src/lib/deep',
    );
  });

  it('returns null when nothing changed', () => {
    expect(changedFolder(new Set(['src']), new Set(['src']))).toBeNull();
  });
});
