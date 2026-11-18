import { afterEach, describe, expect, it, vi } from 'vitest';
import { request } from './client.js';
import { getSource } from './repos.js';

vi.mock('./client.js', () => ({ request: vi.fn() }));

describe('getSource', () => {
  afterEach(() => vi.mocked(request).mockReset());

  it('asks the source endpoint of the file', async () => {
    vi.mocked(request).mockResolvedValue({ path: 'a.ts', language: 'ts', content: 'x' });
    await expect(getSource('repo-1', 'node-9')).resolves.toMatchObject({ content: 'x' });
    expect(request).toHaveBeenCalledWith('/repos/repo-1/nodes/node-9/source');
  });
});
