import { beforeEach, describe, expect, it, vi } from 'vitest';
import { acknowledgeAiNotice, analyzeFile } from './ai.js';
import { request } from './client.js';

vi.mock('./client.js', () => ({ request: vi.fn() }));

describe('AI API', () => {
  beforeEach(() => vi.mocked(request).mockReset());

  it('posts a blast-radius analysis for one file', () => {
    analyzeFile('repo 1', 'node-1');
    expect(request).toHaveBeenCalledWith('/repos/repo%201/analyze', {
      method: 'POST',
      body: { mode: 'blast_radius', nodeId: 'node-1' },
    });
  });

  it('records the AI notice acknowledgement', () => {
    acknowledgeAiNotice();
    expect(request).toHaveBeenCalledWith('/me/ai-notice', { method: 'POST' });
  });
});
