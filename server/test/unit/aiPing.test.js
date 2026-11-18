import { describe, it, expect, vi } from 'vitest';
import { ApiError } from '@google/genai';
import { runAiPing } from '../../src/aiPing.js';

describe('ai:ping (spec 7.7)', () => {
  it('sends one tiny request to every configured model and prints one line each', async () => {
    const generateContent = vi.fn(async ({ model }) => {
      if (model === 'gemini-b') throw new ApiError({ message: 'quota', status: 429 });
      if (model === 'gemini-c') throw new ApiError({ message: 'gone', status: 404 });
      return { text: '{"ok":true}', candidates: [{ finishReason: 'STOP' }] };
    });
    const lines = [];
    let t = 0;
    const rows = await runAiPing({
      models: ['gemini-a', 'gemini-b', 'gemini-c'],
      timeoutMs: 1000,
      sdk: { models: { generateContent } },
      log: (l) => lines.push(l),
      now: () => (t += 50),
    });

    expect(generateContent.mock.calls.map((c) => c[0].model)).toEqual([
      'gemini-a',
      'gemini-b',
      'gemini-c',
    ]);
    expect(rows.map((r) => r.result)).toEqual([
      'ok',
      'quota (HTTP 429)',
      'model_unavailable (HTTP 404)',
    ]);
    expect(lines).toHaveLength(3);
    expect(lines[0]).toMatch(/^gemini-a\s+ok\s+50 ms$/);
    expect(lines[1]).toMatch(/^gemini-b\s+quota \(HTTP 429\)\s+50 ms$/);
    // No repository data in the request.
    expect(generateContent.mock.calls[0][0].contents).not.toMatch(/REPOSITORY_DATA/);
  });

  it('reports a timeout for a model that does not answer', async () => {
    vi.useFakeTimers();
    try {
      const sdk = { models: { generateContent: () => new Promise(() => {}) } };
      const lines = [];
      const pending = runAiPing({
        models: ['slow'],
        timeoutMs: 500,
        sdk,
        log: (l) => lines.push(l),
      });
      await vi.advanceTimersByTimeAsync(500);
      expect((await pending)[0].result).toBe('timeout');
      expect(lines[0]).toMatch(/^slow\s+timeout/);
    } finally {
      vi.useRealTimers();
    }
  });
});
