import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SAMPLE } from '../../../test/graphFixture.js';
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
const TARGET = 'f:src/lib/deep/math.ts';

// math.ts is imported directly by utils.ts and app/blog/page.tsx. app/layout.tsx has no
// imports at all, so only the AI result brings it into the highlighted set.
const RESULT = {
  noDependents: false,
  cached: false,
  summary: 's',
  risks: [
    { path: 'app/blog/page.tsx', level: 'high', reason: 'r' },
    { path: 'src/lib/utils.ts', level: 'medium', reason: 'r' },
    { path: 'app/layout.tsx', level: 'low', reason: 'r' },
  ],
  removedCount: 0,
};

async function renderAnalysed() {
  store().loadGraph(SAMPLE);
  render(
    <div style={{ width: 1280, height: 720 }}>
      <GraphCanvas />
    </div>,
  );
  await screen.findByTestId('graph-canvas');
  act(() => store().selectFile(TARGET));
  view.fitBounds.mockClear();
  act(() => store().finishAnalysis(TARGET, RESULT, store().graph));
}

describe('GraphCanvas AI extension (spec 8.6 item 9)', () => {
  beforeEach(() => {
    store().reset();
    view.fitBounds.mockClear();
    vi.stubGlobal('matchMedia', (query) => ({ matches: query.includes('reduce') }));
  });

  it('opens the collapsed folder holding a risk file and highlights every risk file', async () => {
    await renderAnalysed();
    expect(store().expandedFolders.has('app')).toBe(true);
    expect(store().expandedFolders.has('app/blog')).toBe(true);
    for (const id of ['f:app/blog/page.tsx', 'f:src/lib/utils.ts', 'f:app/layout.tsx']) {
      expect(nodeEl(id)).not.toBeNull();
      expect(nodeEl(id)).not.toHaveClass('is-dim');
    }
  });

  it('borders files by risk level: high, medium, dashed low', async () => {
    await renderAnalysed();
    expect(nodeEl('f:app/blog/page.tsx')).toHaveClass('risk-high');
    expect(nodeEl('f:src/lib/utils.ts')).toHaveClass('risk-medium');
    expect(nodeEl('f:app/layout.tsx')).toHaveClass('risk-low');
    expect(nodeEl(TARGET)).toHaveClass('is-selected');
    expect(nodeEl(TARGET)).not.toHaveClass('risk-high');
  });

  it('draws the edge between the target and its high-risk file in the risk colour', async () => {
    await renderAnalysed();
    const risky = document.querySelectorAll('.gc-edge.is-risk-high');
    expect(risky).toHaveLength(1);
    expect(risky[0]).not.toHaveClass('is-dim');
    expect(document.querySelectorAll('.gc-edge-arrow.is-risk-high')).toHaveLength(1);
  });

  it('fits the view to the extended set', async () => {
    await renderAnalysed();
    expect(view.fitBounds).toHaveBeenCalledTimes(1);
  });

  it('drops the risk styling when another file is selected', async () => {
    await renderAnalysed();
    act(() => store().selectFile('f:index.ts'));
    expect(document.querySelectorAll('.risk-high, .risk-medium, .risk-low')).toHaveLength(0);
    expect(document.querySelectorAll('.gc-edge.is-risk-high')).toHaveLength(0);
  });
});
