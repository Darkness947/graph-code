import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, request } from './client.js';

const respond = (status, body) =>
  vi.fn().mockResolvedValue(
    new Response(body === undefined ? null : JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  );

afterEach(() => vi.unstubAllGlobals());

describe('request', () => {
  it('calls the path under /api on this origin and returns the JSON body', async () => {
    const fetchMock = respond(200, { login: 'octocat' });
    vi.stubGlobal('fetch', fetchMock);

    await expect(request('/me')).resolves.toEqual({ login: 'octocat' });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/me',
      expect.objectContaining({ method: 'GET', credentials: 'same-origin' }),
    );
  });

  it('returns null for 204', async () => {
    vi.stubGlobal('fetch', respond(204));
    await expect(request('/auth/logout', { method: 'POST' })).resolves.toBeNull();
  });

  it('sends a JSON body with its content type', async () => {
    const fetchMock = respond(202, {});
    vi.stubGlobal('fetch', fetchMock);

    await request('/repos', { method: 'POST', body: { repo: 'owner/name' } });
    const [, init] = fetchMock.mock.calls[0];
    expect(init.body).toBe('{"repo":"owner/name"}');
    expect(init.headers['Content-Type']).toBe('application/json');
  });

  it('throws an ApiError carrying the standard error shape', async () => {
    vi.stubGlobal(
      'fetch',
      respond(401, {
        error: { code: 'UNAUTHENTICATED', message: 'Sign in to continue.', requestId: 'r-1' },
      }),
    );

    const err = await request('/me').catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({
      status: 401,
      code: 'UNAUTHENTICATED',
      message: 'Sign in to continue.',
      requestId: 'r-1',
    });
  });

  it('falls back to INTERNAL when the error body is not JSON', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>', { status: 502 })));
    await expect(request('/me')).rejects.toMatchObject({ status: 502, code: 'INTERNAL' });
  });

  it('reports a network failure as status 0', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await expect(request('/me')).rejects.toMatchObject({ status: 0, code: 'INTERNAL' });
  });
});
