import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SAMPLE } from '../../../test/graphFixture.js';
import { ApiError, request } from '../../api/client.js';
import { useWorkspaceStore } from '../../store/workspaceStore.js';
import { useSessionStore } from '../auth/useSession.js';
import AiPanel, { CARD_LIMIT } from './AiPanel.jsx';
import { DISCLAIMER, NO_DEPENDENTS, NOTICE_TEXT } from './messages.js';

vi.mock('../../api/client.js', async (importOriginal) => ({
  ...(await importOriginal()),
  request: vi.fn(),
}));

const store = () => useWorkspaceStore.getState();
const TARGET = 'f:src/lib/utils.ts';
const ANALYZE = { name: 'Analyze change impact (AI)' };

const result = (over = {}) => ({
  mode: 'blast_radius',
  targetPath: 'src/lib/utils.ts',
  cached: false,
  generatedAt: '2026-11-20T12:00:00Z',
  noDependents: false,
  dependents: [{ path: 'app/page.tsx', distance: 1 }],
  summary: 'Changing utils.ts mainly affects the pages.',
  risks: [
    { path: 'app/page.tsx', level: 'high', reason: 'Calls format() directly.' },
    { path: 'index.ts', level: 'medium', reason: 'Re-exports it.' },
    { path: 'src/main.ts', level: 'low', reason: 'Imports a type.' },
  ],
  removedCount: 0,
  ...over,
});

/** A promise the test settles by hand, to hold a request in flight. */
function deferred() {
  let resolve;
  const promise = new Promise((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function renderPanel({ acknowledged = true, nodeId = TARGET } = {}) {
  useSessionStore.setState({
    status: 'authenticated',
    user: { id: 'u1', login: 'me', avatarUrl: null, aiNoticeAcknowledged: acknowledged },
  });
  store().loadGraph(SAMPLE);
  store().selectFile(nodeId);
  return render(<AiPanel repoId="repo-1" nodeId={nodeId} />);
}

const analyzeCalls = () =>
  vi.mocked(request).mock.calls.filter(([path]) => path.endsWith('/analyze'));

describe('AiPanel (spec 8.6)', () => {
  beforeEach(() => {
    store().reset();
    vi.mocked(request).mockReset();
  });

  describe('loading', () => {
    it('disables the button and shows a spinner and "Analyzing…", keeping the focus', async () => {
      const user = userEvent.setup();
      const pending = deferred();
      vi.mocked(request).mockReturnValue(pending.promise);
      renderPanel();
      const focus = store().focus;

      await user.click(screen.getByRole('button', ANALYZE));
      const button = screen.getByRole('button', { name: 'Analyzing…' });
      expect(button).toBeDisabled();
      expect(button.querySelector('.spinner-border')).not.toBeNull();
      expect(store().focus).toBe(focus);
      expect(request).toHaveBeenCalledWith('/repos/repo-1/analyze', {
        method: 'POST',
        body: { mode: 'blast_radius', nodeId: TARGET },
      });
      await act(async () => pending.resolve(result()));
    });

    it('sends one request however often the button is clicked', async () => {
      const user = userEvent.setup();
      const pending = deferred();
      vi.mocked(request).mockReturnValue(pending.promise);
      renderPanel();
      await user.dblClick(screen.getByRole('button', ANALYZE));
      await user.click(screen.getByRole('button', { name: 'Analyzing…' }));
      expect(analyzeCalls()).toHaveLength(1);
      await act(async () => pending.resolve(result()));
    });

    it('is disabled while another file is being analysed', () => {
      renderPanel();
      act(() => store().startAnalysis('f:index.ts'));
      expect(screen.getByRole('button', ANALYZE)).toBeDisabled();
    });
  });

  describe('result', () => {
    it('shows the header, AI badge, summary, risk cards and the disclaimer', async () => {
      const user = userEvent.setup();
      vi.mocked(request).mockResolvedValue(result());
      renderPanel();
      await user.click(screen.getByRole('button', ANALYZE));

      const section = await screen.findByRole('region', { name: 'Change impact' });
      expect(within(section).getByText('AI-generated')).toHaveClass('ai-badge');
      expect(within(section).queryByText('Cached')).toBeNull();
      expect(
        within(section).getByText('Changing utils.ts mainly affects the pages.'),
      ).toBeVisible();
      expect(within(section).getByText('High')).toHaveClass('ai-level-high');
      expect(within(section).getByText('Medium')).toHaveClass('ai-level-medium');
      expect(within(section).getByText('Low')).toHaveClass('ai-level', 'ai-level-low');
      expect(within(section).getByText('Calls format() directly.')).toHaveClass('ai-reason');
      expect(within(section).getByText(DISCLAIMER)).toBeVisible();
      expect(within(section).queryByText(/were removed because/)).toBeNull();
    });

    it('labels a cached result and notes removed files', async () => {
      const user = userEvent.setup();
      vi.mocked(request).mockResolvedValue(result({ cached: true, removedCount: 2 }));
      renderPanel();
      await user.click(screen.getByRole('button', ANALYZE));
      expect(await screen.findByText('Cached')).toHaveClass('ai-badge');
      expect(
        screen.getByText(
          "2 suggested file(s) were removed because they don't exist in this repository.",
        ),
      ).toBeVisible();
    });

    it('selects a file from its risk card', async () => {
      const user = userEvent.setup();
      vi.mocked(request).mockResolvedValue(result());
      renderPanel();
      await user.click(screen.getByRole('button', ANALYZE));
      await user.click(await screen.findByRole('button', { name: 'app/page.tsx' }));
      expect(store().selectedNodeId).toBe('f:app/page.tsx');
    });

    it('shows the first 25 cards and reveals the rest with "+N more files"', async () => {
      const user = userEvent.setup();
      const risks = Array.from({ length: CARD_LIMIT + 3 }, (_, i) => ({
        path: `gen/f${i}.ts`,
        level: 'low',
        reason: `r${i}`,
      }));
      vi.mocked(request).mockResolvedValue(result({ risks }));
      renderPanel();
      await user.click(screen.getByRole('button', ANALYZE));
      await screen.findByText('r0');
      expect(document.querySelectorAll('.ai-card')).toHaveLength(25);
      await user.click(screen.getByRole('button', { name: '+3 more files' }));
      expect(document.querySelectorAll('.ai-card')).toHaveLength(28);
      expect(screen.queryByText(/more files/)).toBeNull();
    });
  });

  describe('no dependents', () => {
    it('shows a green check and no AI-generated badge', async () => {
      const user = userEvent.setup();
      vi.mocked(request).mockResolvedValue(
        result({ noDependents: true, dependents: [], risks: [], summary: '' }),
      );
      renderPanel();
      await user.click(screen.getByRole('button', ANALYZE));
      const box = (await screen.findByText(NO_DEPENDENTS)).closest('.ai-state');
      expect(box).toHaveClass('ai-safe');
      expect(box).not.toHaveClass('ai-error');
      expect(box.querySelector('i')).toHaveClass('bi-check-circle-fill');
      expect(screen.queryByText('AI-generated')).toBeNull();
      expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
      expect(screen.queryByRole('alert')).toBeNull();
    });
  });

  describe('errors', () => {
    it.each([
      [
        'AI_QUOTA_EXCEEDED',
        429,
        'AI analysis is temporarily unavailable — try again in a moment.',
        'bi-clock',
      ],
      ['AI_TIMEOUT', 504, 'The AI service took too long to respond. Try again.', 'bi-clock'],
      [
        'AI_UNREACHABLE',
        502,
        "Couldn't reach the AI service. Check your connection and try again.",
        'bi-plug',
      ],
      [
        'AI_MALFORMED',
        502,
        "Couldn't generate a reliable analysis for this file. Try again.",
        'bi-exclamation-triangle',
      ],
      [
        'GITHUB_UNAVAILABLE',
        502,
        "GitHub isn't responding right now. Try again in a moment.",
        'bi-plug',
      ],
      ['INTERNAL', 500, 'Something went wrong. Try again.', 'bi-exclamation-triangle'],
    ])('%s shows its own message and icon', async (code, status, message, icon) => {
      const user = userEvent.setup();
      vi.mocked(request).mockRejectedValue(new ApiError(status, { code, message: 'server text' }));
      renderPanel();
      await user.click(screen.getByRole('button', ANALYZE));
      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent(message);
      expect(alert).toHaveClass('ai-state', 'ai-error');
      expect(alert).not.toHaveClass('ai-safe');
      expect(alert.querySelector('i')).toHaveClass(icon);
      expect(alert.querySelector('.bi-check-circle-fill')).toBeNull();
      expect(within(alert).getByRole('button', { name: 'Try again' })).toBeEnabled();
      expect(screen.queryByText(NO_DEPENDENTS)).toBeNull();
    });

    it('RATE_LIMITED says how long to wait', async () => {
      const user = userEvent.setup();
      vi.mocked(request).mockRejectedValue(
        new ApiError(429, { code: 'RATE_LIMITED', retryAfterSeconds: 37 }),
      );
      renderPanel();
      await user.click(screen.getByRole('button', ANALYZE));
      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent("You're doing that too often. Try again in 37 seconds.");
      expect(alert.querySelector('i')).toHaveClass('bi-clock');
    });

    it('Try again runs the analysis again and keeps the focus', async () => {
      const user = userEvent.setup();
      vi.mocked(request)
        .mockRejectedValueOnce(new ApiError(504, { code: 'AI_TIMEOUT' }))
        .mockResolvedValueOnce(result());
      renderPanel();
      const focus = store().focus;
      await user.click(screen.getByRole('button', ANALYZE));
      await screen.findByRole('alert');
      expect(store().focus).toBe(focus);
      await user.click(screen.getByRole('button', { name: 'Try again' }));
      expect(await screen.findByRole('region', { name: 'Change impact' })).toBeVisible();
      expect(analyzeCalls()).toHaveLength(2);
    });

    it('a 401 ends the session instead of showing an error', async () => {
      const user = userEvent.setup();
      vi.mocked(request).mockRejectedValue(new ApiError(401, { code: 'UNAUTHENTICATED' }));
      renderPanel();
      await user.click(screen.getByRole('button', ANALYZE));
      await waitFor(() => expect(useSessionStore.getState().status).toBe('anonymous'));
      expect(screen.queryByRole('alert')).toBeNull();
    });
  });

  describe('AI notice modal', () => {
    it('shows the notice the first time; Cancel sends nothing', async () => {
      const user = userEvent.setup();
      renderPanel({ acknowledged: false });
      await user.click(screen.getByRole('button', ANALYZE));
      const dialog = await screen.findByRole('dialog', { name: 'Before your first AI analysis' });
      expect(within(dialog).getByText(NOTICE_TEXT)).toBeVisible();
      await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect(request).not.toHaveBeenCalled();
    });

    it('"I understand, analyze" records the notice, then runs the analysis', async () => {
      const user = userEvent.setup();
      vi.mocked(request).mockImplementation(async (path) =>
        path === '/me/ai-notice' ? null : result(),
      );
      renderPanel({ acknowledged: false });
      await user.click(screen.getByRole('button', ANALYZE));
      await user.click(await screen.findByRole('button', { name: 'I understand, analyze' }));

      expect(await screen.findByRole('region', { name: 'Change impact' })).toBeVisible();
      expect(vi.mocked(request).mock.calls.map(([path]) => path)).toEqual([
        '/me/ai-notice',
        '/repos/repo-1/analyze',
      ]);
      expect(useSessionStore.getState().user.aiNoticeAcknowledged).toBe(true);
    });

    it('is not shown once acknowledged', async () => {
      const user = userEvent.setup();
      vi.mocked(request).mockResolvedValue(result());
      renderPanel({ acknowledged: true });
      await user.click(screen.getByRole('button', ANALYZE));
      await screen.findByRole('region', { name: 'Change impact' });
      expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('stays open with an error when the acknowledgement fails', async () => {
      const user = userEvent.setup();
      vi.mocked(request).mockRejectedValue(new ApiError(500, { code: 'INTERNAL' }));
      renderPanel({ acknowledged: false });
      await user.click(screen.getByRole('button', ANALYZE));
      const dialog = await screen.findByRole('dialog');
      await user.click(within(dialog).getByRole('button', { name: 'I understand, analyze' }));
      expect(await within(dialog).findByRole('alert')).toHaveTextContent(
        'Something went wrong. Try again.',
      );
      expect(analyzeCalls()).toHaveLength(0);
    });
  });
});
