import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SAMPLE } from '../../../test/graphFixture.js';
import { useWorkspaceStore } from '../../store/workspaceStore.js';
import SearchBar from './SearchBar.jsx';

const store = () => useWorkspaceStore.getState();

describe('SearchBar (spec 8.6)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    store().reset();
    store().loadGraph(SAMPLE);
  });
  afterEach(() => vi.useRealTimers());

  const setup = () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<SearchBar />);
    return { user, input: screen.getByPlaceholderText('Search files…') };
  };
  const settle = () => act(() => vi.advanceTimersByTime(150));

  it('waits 150 ms before searching', async () => {
    const { user, input } = setup();
    await user.type(input, 'util');
    expect(screen.queryByRole('listbox')).toBeNull();
    settle();
    expect(screen.getByRole('option')).toHaveTextContent('src/lib/utils.ts');
  });

  it('shows the matched part in bold', async () => {
    const { user, input } = setup();
    await user.type(input, 'UTIL');
    settle();
    expect(screen.getByRole('option').querySelector('strong')).toHaveTextContent('util');
  });

  it('says when nothing matches, with the query in the message', async () => {
    const { user, input } = setup();
    await user.type(input, 'zzz');
    settle();
    expect(screen.getByText("No files match 'zzz'")).toBeInTheDocument();
  });

  it('selects the first result on Enter and clears the search', async () => {
    const { user, input } = setup();
    await user.type(input, 'page');
    settle();
    await user.keyboard('{Enter}');
    expect(store().selectedNodeId).toBe('f:app/page.tsx');
    expect(store().focus.active).toBe(true);
    expect(input).toHaveValue('');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('selects on Enter without waiting for the debounce', async () => {
    const { user, input } = setup();
    await user.type(input, 'main{Enter}');
    expect(store().selectedNodeId).toBe('f:src/main.ts');
    expect(input).toHaveValue('');
  });

  it('moves with the arrow keys and selects on click', async () => {
    const { user, input } = setup();
    await user.type(input, 'page');
    settle();
    await user.keyboard('{ArrowDown}{Enter}');
    expect(store().selectedNodeId).toBe('f:app/blog/page.tsx');
    await user.type(input, 'main');
    settle();
    await user.click(screen.getByRole('option'));
    expect(store().selectedNodeId).toBe('f:src/main.ts');
  });

  it('clears on Escape', async () => {
    const { user, input } = setup();
    await user.type(input, 'page');
    settle();
    await user.keyboard('{Escape}');
    expect(input).toHaveValue('');
    expect(store().search.query).toBe('');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('shows at most 20 results', async () => {
    const nodes = Array.from({ length: 30 }, (_, i) => ({
      id: `f:src/file${i}.ts`,
      path: `src/file${i}.ts`,
      name: `file${i}.ts`,
      type: 'file',
      parentPath: 'src',
      metrics: { fanIn: 0, fanOut: 0 },
    }));
    store().loadGraph({ ...SAMPLE, nodes, edges: [] });
    const { user, input } = setup();
    await user.type(input, 'file');
    settle();
    expect(screen.getAllByRole('option')).toHaveLength(20);
  });
});
