import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SAMPLE } from '../../../test/graphFixture.js';
import { ApiError } from '../../api/client.js';
import { getSource } from '../../api/repos.js';
import { useWorkspaceStore } from '../../store/workspaceStore.js';
import CodeDrawer, { LOAD_FAILED, TOO_LARGE } from './CodeDrawer.jsx';

vi.mock('../../api/repos.js', () => ({ getSource: vi.fn() }));

const store = () => useWorkspaceStore.getState();
const body = { getBoundingClientRect: () => ({ bottom: 1000, height: 1000 }) };

const source = (path, content) => ({ path, language: 'ts', content });

function renderDrawer() {
  return render(<CodeDrawer repoId="repo-1" containerRef={{ current: body }} />);
}

describe('CodeDrawer (spec 8.6)', () => {
  beforeEach(() => {
    store().reset();
    store().loadGraph(SAMPLE);
    vi.mocked(getSource).mockReset();
  });

  it('shows only a handle by default and loads nothing', () => {
    renderDrawer();
    expect(screen.getByRole('button', { name: /^Code/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Close code' })).toBeNull();
    expect(getSource).not.toHaveBeenCalled();
  });

  it('opens from the handle and closes from its button', async () => {
    const user = userEvent.setup();
    renderDrawer();
    await user.click(screen.getByRole('button', { name: /^Code/ }));
    expect(store().codeDrawer.open).toBe(true);
    expect(screen.getByText('Select a file to view its code.')).toBeInTheDocument();
    expect(screen.getByLabelText('Code')).toHaveStyle({ height: '40%' });

    await user.click(screen.getByRole('button', { name: 'Close code' }));
    expect(store().codeDrawer.open).toBe(false);
  });

  it('shows a skeleton, then the path and numbered lines of the selected file', async () => {
    let resolve;
    vi.mocked(getSource).mockReturnValue(new Promise((r) => (resolve = r)));
    act(() => {
      store().selectFile('f:index.ts');
      store().openCode();
    });
    renderDrawer();
    expect(screen.getByRole('status', { name: 'Loading code' })).toBeInTheDocument();
    expect(getSource).toHaveBeenCalledWith('repo-1', 'f:index.ts');

    resolve(source('index.ts', 'const a = 1;\nexport default a;'));
    expect(await screen.findByText('export')).toBeInTheDocument();
    expect(screen.getByText('index.ts')).toBeInTheDocument();
    expect(document.querySelectorAll('.code-no')).toHaveLength(2);
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('shows the too-large message', async () => {
    vi.mocked(getSource).mockResolvedValue({ tooLarge: true });
    act(() => {
      store().selectFile('f:index.ts');
      store().openCode();
    });
    renderDrawer();
    expect(await screen.findByText(TOO_LARGE)).toBeInTheDocument();
  });

  it('shows an error with Retry, and loads again on Retry', async () => {
    const user = userEvent.setup();
    vi.mocked(getSource)
      .mockRejectedValueOnce(new ApiError(502, { code: 'GITHUB_UNAVAILABLE' }))
      .mockResolvedValueOnce(source('index.ts', 'let ok = true;'));
    act(() => {
      store().selectFile('f:index.ts');
      store().openCode();
    });
    renderDrawer();
    expect(await screen.findByText(LOAD_FAILED)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('ok')).toBeInTheDocument();
    expect(screen.queryByText(LOAD_FAILED)).toBeNull();
    expect(getSource).toHaveBeenCalledTimes(2);
  });

  it('loads the new file when the selection changes, and ignores a late answer for the old one', async () => {
    let resolveFirst;
    vi.mocked(getSource)
      .mockReturnValueOnce(new Promise((r) => (resolveFirst = r)))
      .mockResolvedValueOnce(source('src/main.ts', 'let second = 2;'));
    act(() => {
      store().selectFile('f:index.ts');
      store().openCode();
    });
    renderDrawer();
    act(() => store().selectFile('f:src/main.ts'));
    expect(await screen.findByText('second')).toBeInTheDocument();
    expect(getSource).toHaveBeenLastCalledWith('repo-1', 'f:src/main.ts');

    await act(async () => resolveFirst(source('index.ts', 'let first = 1;')));
    expect(screen.queryByText('first')).toBeNull();
    expect(screen.getByText('second')).toBeInTheDocument();
  });

  it('does not show the old file under the new name while the new one loads', async () => {
    vi.mocked(getSource)
      .mockResolvedValueOnce(source('index.ts', 'let first = 1;'))
      .mockReturnValueOnce(new Promise(() => {}));
    act(() => {
      store().selectFile('f:index.ts');
      store().openCode();
    });
    renderDrawer();
    await screen.findByText('first');
    act(() => store().selectFile('f:src/main.ts'));
    expect(screen.queryByText('first')).toBeNull();
    expect(screen.getByRole('status', { name: 'Loading code' })).toBeInTheDocument();
  });

  it('resizes by dragging the top edge, within 20 to 70 percent', async () => {
    act(() => store().openCode());
    renderDrawer();
    const grip = screen.getByRole('separator', { name: 'Resize code drawer' });
    fireEvent.pointerDown(grip, { clientY: 600 });
    fireEvent(window, Object.assign(new Event('pointermove'), { clientY: 500 }));
    await waitFor(() => expect(store().codeDrawer.heightPct).toBe(50));
    fireEvent(window, Object.assign(new Event('pointermove'), { clientY: 100 }));
    await waitFor(() => expect(store().codeDrawer.heightPct).toBe(70));
    fireEvent(window, Object.assign(new Event('pointermove'), { clientY: 990 }));
    await waitFor(() => expect(store().codeDrawer.heightPct).toBe(20));
    fireEvent(window, new Event('pointerup'));
    fireEvent(window, Object.assign(new Event('pointermove'), { clientY: 500 }));
    expect(store().codeDrawer.heightPct).toBe(20);
  });

  it('resizes from the keyboard: focusable, arrow keys move 5 percent within 20 to 70', async () => {
    act(() => store().openCode());
    renderDrawer();
    const user = userEvent.setup();
    const grip = screen.getByRole('separator', { name: 'Resize code drawer' });
    expect(grip).toHaveAttribute('aria-valuenow', '40');
    expect(grip).toHaveAttribute('aria-valuemin', '20');
    expect(grip).toHaveAttribute('aria-valuemax', '70');

    grip.focus();
    expect(grip).toHaveFocus();
    await user.keyboard('{ArrowUp}');
    expect(store().codeDrawer.heightPct).toBe(45);
    expect(grip).toHaveAttribute('aria-valuenow', '45');
    await user.keyboard('{ArrowDown}{ArrowDown}');
    expect(store().codeDrawer.heightPct).toBe(35);
    for (let i = 0; i < 10; i++) await user.keyboard('{ArrowUp}');
    expect(store().codeDrawer.heightPct).toBe(70);
    for (let i = 0; i < 20; i++) await user.keyboard('{ArrowDown}');
    expect(store().codeDrawer.heightPct).toBe(20);
  });
});
