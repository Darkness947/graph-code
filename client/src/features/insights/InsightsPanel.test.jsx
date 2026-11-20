import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { makeGraph, SAMPLE } from '../../../test/graphFixture.js';
import { useWorkspaceStore } from '../../store/workspaceStore.js';
import InsightsPanel, { formatBytes, NO_EDGES } from './InsightsPanel.jsx';

const store = () => useWorkspaceStore.getState();
const NONE = { count: 0, items: [] };

const renderPanel = (graph = SAMPLE, props = {}) => {
  store().loadGraph(graph);
  return render(<InsightsPanel unresolved={NONE} {...props} />);
};

describe('InsightsPanel (spec 8.6)', () => {
  beforeEach(() => store().reset());

  describe('nothing selected', () => {
    it('invites a click and shows the repository facts', () => {
      renderPanel();
      expect(screen.getByText('Click a file to inspect it.')).toBeInTheDocument();
      expect(screen.getByText('Files').nextSibling).toHaveTextContent('7');
      expect(screen.getByText('Dependencies').nextSibling).toHaveTextContent('7');
      expect(screen.queryByText(NO_EDGES)).toBeNull();
    });

    it('lists the unresolved imports behind a Show toggle', async () => {
      const user = userEvent.setup();
      const items = [
        { sourcePath: 'src/main.ts', specifier: './gone', reason: 'file_not_found' },
        { sourcePath: 'app/page.tsx', specifier: '@/x', reason: 'alias_not_found' },
      ];
      renderPanel(SAMPLE, { unresolved: { count: 2, items } });
      expect(screen.queryByText('./gone')).toBeNull();

      await user.click(screen.getByRole('button', { name: 'Show' }));
      expect(screen.getByText('src/main.ts')).toBeInTheDocument();
      expect(screen.getByText('./gone')).toBeInTheDocument();
      expect(screen.getByText('file_not_found')).toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: 'Hide' }));
      expect(screen.queryByText('./gone')).toBeNull();
    });

    it('offers no toggle when nothing is unresolved', () => {
      renderPanel();
      expect(screen.queryByRole('button', { name: 'Show' })).toBeNull();
    });

    it('says so when the repository has no edges', () => {
      renderPanel(makeGraph(['a.ts', 'b.ts']));
      expect(screen.getByText(NO_EDGES)).toBeInTheDocument();
    });

    it('shows the skipped-files line', () => {
      renderPanel(SAMPLE, { skippedFiles: 3 });
      expect(
        screen.getByText("3 file(s) couldn't be parsed and were skipped."),
      ).toBeInTheDocument();
    });
  });

  describe('file selected', () => {
    const select = (id) => act(() => store().selectFile(id));

    it('shows the path, language, size and import counts', () => {
      renderPanel();
      select('f:src/lib/utils.ts');
      expect(screen.getByRole('heading', { name: 'src/lib/utils.ts' })).toBeInTheDocument();
      expect(screen.getByText('ts')).toBeInTheDocument();
      expect(screen.getByText('1.0 KB')).toBeInTheDocument();
      expect(screen.getByText('Imports 1 · Used by 3')).toBeInTheDocument();
      expect(screen.queryByText('Click a file to inspect it.')).toBeNull();
    });

    it('lists what it imports and what uses it, and selects a clicked file', async () => {
      const user = userEvent.setup();
      renderPanel();
      select('f:src/lib/utils.ts');

      const imports = screen.getByRole('button', { name: /^Imports/ }).closest('section');
      expect(within(imports).getByText('src/lib/deep/math.ts')).toBeInTheDocument();
      const usedBy = screen.getByRole('button', { name: /^Used by/ }).closest('section');
      expect(
        within(usedBy)
          .getAllByRole('button')
          .slice(1)
          .map((b) => b.textContent),
      ).toEqual(['app/page.tsx', 'index.ts', 'src/main.ts']);

      await user.click(within(usedBy).getByRole('button', { name: 'index.ts' }));
      expect(store().selectedNodeId).toBe('f:index.ts');
      expect(screen.getByRole('heading', { name: 'index.ts' })).toBeInTheDocument();
    });

    it('collapses a list', async () => {
      const user = userEvent.setup();
      renderPanel();
      select('f:src/lib/utils.ts');
      await user.click(screen.getByRole('button', { name: /^Imports/ }));
      expect(screen.queryByText('src/lib/deep/math.ts')).toBeNull();
    });

    it('opens the code drawer from View code and offers the AI analysis', async () => {
      const user = userEvent.setup();
      renderPanel();
      select('f:index.ts');
      await user.click(screen.getByRole('button', { name: 'View code' }));
      expect(store().codeDrawer.open).toBe(true);
      expect(screen.getByRole('button', { name: 'Analyze change impact (AI)' })).toBeEnabled();
    });
  });

  describe('folder selected', () => {
    it('shows the path and file count, and expands the folder on the canvas', async () => {
      const user = userEvent.setup();
      renderPanel();
      act(() => store().selectFolder('d:src'));
      expect(screen.getByRole('heading', { name: 'src' })).toBeInTheDocument();
      expect(screen.getByText('3 files')).toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: 'Expand on canvas' }));
      expect(store().expandedFolders.has('src')).toBe(true);
      expect(screen.getByRole('button', { name: 'Expand on canvas' })).toBeInTheDocument();
    });
  });
});

describe('formatBytes', () => {
  it('uses bytes, KB and MB', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2.0 KB');
    expect(formatBytes(3 * 1024 * 1024)).toBe('3.0 MB');
  });
});
