import { describe, it, expect, vi } from 'vitest';
import { createGithubClient, assertAllowedUrl } from '../../src/services/github/githubClient.js';

const SHA = 'a'.repeat(40);
const ok = (data, status = 200) => ({ status, data, headers: {} });
const redirect = (location) => ({ status: 302, data: '', headers: { location } });

/** Builds a client over a mocked http whose request() plays back the given steps in order. */
function make(...steps) {
  const request = vi.fn();
  for (const s of steps) {
    if (s instanceof Error) request.mockRejectedValueOnce(s);
    else request.mockResolvedValueOnce(s);
  }
  const client = createGithubClient({ maxZipBytes: 1000 }, { request });
  return { client, request };
}

const repoJson = {
  id: 5,
  private: false,
  default_branch: 'main',
  owner: { login: 'Octo' },
  name: 'Hello',
};

describe('allowlist (AC1)', () => {
  it('accepts only https on the three GitHub hosts', () => {
    for (const host of ['github.com', 'api.github.com', 'codeload.github.com']) {
      expect(() => assertAllowedUrl(`https://${host}/x`)).not.toThrow();
    }
  });

  it.each([
    'http://api.github.com/x',
    'https://evil.com/x',
    'https://api.github.com.evil.com/x',
    'https://evilgithub.com/x',
    'https://user@api.github.com/x',
    'https://user:pw@api.github.com/x',
    'https://api.github.com:8443/x',
    'https://api.github.com:443/x',
    'https://api.github.com:/x',
    '//api.github.com:443/x',
    'ftp://github.com/x',
    'not a url',
  ])('rejects %s', (url) => {
    expect(() => assertAllowedUrl(url)).toThrowError(
      expect.objectContaining({ code: 'GITHUB_UNAVAILABLE' }),
    );
  });

  it('rejects a redirect to a non-allowlisted host without requesting it', async () => {
    const { client, request } = make(redirect('https://evil.com/steal'));
    await expect(client.getRepository('t', 'octo', 'hello')).rejects.toMatchObject({
      code: 'GITHUB_UNAVAILABLE',
    });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('follows an allowed redirect and re-checks each target', async () => {
    const { client, request } = make(
      redirect('https://api.github.com/repositories/5'),
      ok(repoJson),
    );
    await expect(client.getRepository('t', 'octo', 'hello')).resolves.toMatchObject({ id: 5 });
    expect(request.mock.calls[1][0].url).toBe('https://api.github.com/repositories/5');
  });

  it('follows at most 3 redirects', async () => {
    const hop = redirect('https://api.github.com/next');
    const { client, request } = make(hop, hop, hop, hop, ok(repoJson));
    await expect(client.getRepository('t', 'octo', 'hello')).rejects.toMatchObject({
      code: 'GITHUB_UNAVAILABLE',
    });
    expect(request).toHaveBeenCalledTimes(4);
  });

  it('allows exactly 3 redirects', async () => {
    const hop = redirect('https://api.github.com/next');
    const { client } = make(hop, hop, hop, ok(repoJson));
    await expect(client.getRepository('t', 'octo', 'hello')).resolves.toMatchObject({ id: 5 });
  });

  it('drops the token when a redirect changes host', async () => {
    const { client, request } = make(redirect('https://github.com/moved'), ok(repoJson));
    await client.getRepository('secret', 'octo', 'hello');
    expect(request.mock.calls[0][0].headers.Authorization).toBe('Bearer secret');
    expect(request.mock.calls[1][0].headers.Authorization).toBeUndefined();
  });

  it.each([
    ['owner', ['t', '-bad', 'repo']],
    ['owner with slash', ['t', 'a/b', 'repo']],
    ['name', ['t', 'octo', 'bad name']],
    ['name dot-dot', ['t', 'octo', '..']],
  ])('rejects an invalid %s before any request', async (_l, args) => {
    const { client, request } = make(ok(repoJson));
    await expect(client.getRepository(...args)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(request).not.toHaveBeenCalled();
  });

  it.each(['../x', 'a/../b', '/abs', 'a//b', './a', ''])(
    'rejects file path %j before any request',
    async (path) => {
      const { client, request } = make(ok('x'));
      await expect(client.getFileSource('t', 'octo', 'hello', path, SHA)).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
      });
      expect(request).not.toHaveBeenCalled();
    },
  );

  it('rejects an invalid SHA, branch or page before any request', async () => {
    const { client, request } = make(ok('x'));
    await expect(client.downloadArchive('octo', 'hello', 'main')).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
    await expect(client.getHeadCommit('t', 'octo', 'hello', '../x')).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
    await expect(client.listUserRepositories('t', 0)).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
    await expect(client.listUserRepositories('t', 1.5)).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
    expect(request).not.toHaveBeenCalled();
  });
});

describe('the five calls (spec 7.4 table)', () => {
  it('getRepository', async () => {
    const { client, request } = make(ok(repoJson));
    const repo = await client.getRepository('tok', 'octo', 'hello');
    expect(repo).toEqual({
      id: 5,
      private: false,
      defaultBranch: 'main',
      owner: 'Octo',
      name: 'Hello',
    });
    const call = request.mock.calls[0][0];
    expect(call.url).toBe('https://api.github.com/repos/octo/hello');
    expect(call.headers.Authorization).toBe('Bearer tok');
    expect(call.maxRedirects).toBe(0);
  });

  it('getRepository parses a JSON string body and rejects an unexpected shape', async () => {
    expect(
      await make(ok(JSON.stringify(repoJson))).client.getRepository('t', 'octo', 'hello'),
    ).toMatchObject({ id: 5 });
    await expect(
      make(ok({ id: 1 })).client.getRepository('t', 'octo', 'hello'),
    ).rejects.toMatchObject({
      code: 'GITHUB_UNAVAILABLE',
    });
  });

  it('getHeadCommit asks for the sha media type and returns trimmed text', async () => {
    const { client, request } = make(ok(`${SHA}\n`));
    expect(await client.getHeadCommit('tok', 'octo', 'hello', 'feature/x y')).toBe(SHA);
    const call = request.mock.calls[0][0];
    expect(call.url).toBe('https://api.github.com/repos/octo/hello/commits/feature/x%20y');
    expect(call.headers.Accept).toBe('application/vnd.github.sha');
  });

  it('getHeadCommit rejects a non-SHA answer', async () => {
    await expect(
      make(ok('<html>')).client.getHeadCommit('t', 'octo', 'hello', 'main'),
    ).rejects.toMatchObject({
      code: 'GITHUB_UNAVAILABLE',
    });
  });

  it('downloadArchive sends no token, asks for an arraybuffer and caps the size', async () => {
    const { client, request } = make(ok(new Uint8Array([1, 2, 3]).buffer));
    const buf = await client.downloadArchive('octo', 'hello', SHA);
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect([...buf]).toEqual([1, 2, 3]);
    const call = request.mock.calls[0][0];
    expect(call.url).toBe(`https://codeload.github.com/octo/hello/zip/${SHA}`);
    expect(call.headers.Authorization).toBeUndefined();
    expect(call.responseType).toBe('arraybuffer');
    expect(call.maxContentLength).toBe(1000);
  });

  it('getFileSource requests the raw media type at the commit and encodes segments', async () => {
    const { client, request } = make(ok('const a = 1;'));
    expect(await client.getFileSource('tok', 'octo', 'hello', 'src/a b/c#.js', SHA)).toBe(
      'const a = 1;',
    );
    const call = request.mock.calls[0][0];
    expect(call.url).toBe(
      `https://api.github.com/repos/octo/hello/contents/src/a%20b/c%23.js?ref=${SHA}`,
    );
    expect(call.headers.Accept).toBe('application/vnd.github.raw');
  });

  it('listUserRepositories uses the exact query from the spec', async () => {
    const { client, request } = make(ok([{ id: 1 }]));
    expect(await client.listUserRepositories('tok', 2)).toEqual([{ id: 1 }]);
    expect(request.mock.calls[0][0].url).toBe(
      'https://api.github.com/user/repos?visibility=public&affiliation=owner,collaborator,organization_member&sort=updated&per_page=30&page=2',
    );
  });
});

describe('timeouts and retries (AC2, spec 7.4)', () => {
  it('uses a 15 s timeout for API calls and 60 s for the ZIP', async () => {
    const api = make(ok(repoJson));
    await api.client.getRepository('t', 'octo', 'hello');
    expect(api.request.mock.calls[0][0].timeout).toBe(15000);
    const zip = make(ok(new ArrayBuffer(1)));
    await zip.client.downloadArchive('octo', 'hello', SHA);
    expect(zip.request.mock.calls[0][0].timeout).toBe(60000);
  });

  it('retries a 5xx once and succeeds', async () => {
    const { client, request } = make(ok('', 503), ok(repoJson));
    await expect(client.getRepository('t', 'octo', 'hello')).resolves.toMatchObject({ id: 5 });
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('gives up after one retry on repeated 5xx with GITHUB_UNAVAILABLE', async () => {
    const { client, request } = make(ok('', 502), ok('', 500), ok(repoJson));
    await expect(client.getRepository('t', 'octo', 'hello')).rejects.toMatchObject({
      code: 'GITHUB_UNAVAILABLE',
      status: 502,
      githubReason: 'SERVER',
    });
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('retries a network error once', async () => {
    const { client, request } = make(
      Object.assign(new Error('reset'), { code: 'ECONNRESET' }),
      ok(repoJson),
    );
    await expect(client.getRepository('t', 'octo', 'hello')).resolves.toMatchObject({ id: 5 });
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('retries a timeout once, then fails', async () => {
    const timeout = () =>
      Object.assign(new Error('timeout of 15000ms exceeded'), { code: 'ECONNABORTED' });
    const { client, request } = make(timeout(), timeout(), ok(repoJson));
    await expect(client.getRepository('t', 'octo', 'hello')).rejects.toMatchObject({
      code: 'GITHUB_UNAVAILABLE',
      githubReason: 'NETWORK',
    });
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('does not retry a 404 and maps it to REPO_NOT_FOUND_ON_GITHUB', async () => {
    const { client, request } = make(ok({}, 404), ok(repoJson));
    await expect(client.getRepository('t', 'octo', 'hello')).rejects.toMatchObject({
      code: 'REPO_NOT_FOUND_ON_GITHUB',
      status: 404,
    });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it.each([401, 403, 422, 429])('does not retry a %i', async (status) => {
    const { client, request } = make(ok({}, status), ok(repoJson));
    await expect(client.getRepository('t', 'octo', 'hello')).rejects.toMatchObject({
      code: 'GITHUB_UNAVAILABLE',
      githubReason: 'CLIENT',
      githubStatus: status,
    });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('does not retry when the ZIP exceeds the size limit', async () => {
    const { client, request } = make(
      new Error('maxContentLength size of 1000 exceeded'),
      ok(new ArrayBuffer(1)),
    );
    await expect(client.downloadArchive('octo', 'hello', SHA)).rejects.toMatchObject({
      code: 'GITHUB_UNAVAILABLE',
      githubReason: 'TOO_LARGE',
    });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('never puts the token in an error message', async () => {
    const { client } = make(ok('', 500), ok('', 500));
    const err = await client.getRepository('super-secret-token', 'octo', 'hello').catch((e) => e);
    expect(JSON.stringify({ m: err.message, x: err.extras })).not.toContain('super-secret-token');
  });

  it('maps a non-JSON 2xx body to GITHUB_UNAVAILABLE instead of a raw SyntaxError', async () => {
    const { client } = make(ok('<html>captive portal</html>'));
    await expect(client.getRepository('t', 'octo', 'hello')).rejects.toMatchObject({
      code: 'GITHUB_UNAVAILABLE',
    });
  });

  it('keeps the token off every hop after leaving the original host', async () => {
    const { client, request } = make(
      redirect('https://github.com/a'),
      redirect('https://api.github.com/b'),
      ok(repoJson),
    );
    await client.getRepository('secret', 'octo', 'hello');
    expect(request.mock.calls[2][0].headers.Authorization).toBeUndefined();
  });

  it('keeps the token on a same-host redirect', async () => {
    const { client, request } = make(redirect('https://api.github.com/b'), ok(repoJson));
    await client.getRepository('secret', 'octo', 'hello');
    expect(request.mock.calls[1][0].headers.Authorization).toBe('Bearer secret');
  });

  it('rejects a redirect Location with an explicit default port', async () => {
    const { client, request } = make(redirect('https://api.github.com:443/b'), ok(repoJson));
    await expect(client.getRepository('t', 'octo', 'hello')).rejects.toMatchObject({
      code: 'GITHUB_UNAVAILABLE',
    });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('clears the earlier 5xx status when the retry fails with a network error', async () => {
    const { client } = make(ok('', 503), new Error('reset'));
    const err = await client.getRepository('t', 'octo', 'hello').catch((e) => e);
    expect(err.githubReason).toBe('NETWORK');
    expect(err.githubStatus).toBeUndefined();
  });

  it('caps file source at 1 MB and does not retry when it is exceeded', async () => {
    const { client, request } = make(
      new Error('maxContentLength size of 1048576 exceeded'),
      ok('x'),
    );
    await expect(client.getFileSource('t', 'octo', 'hello', 'a.js', SHA)).rejects.toMatchObject({
      code: 'GITHUB_UNAVAILABLE',
      githubReason: 'TOO_LARGE',
    });
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0][0].maxContentLength).toBe(1024 * 1024);
    expect(request.mock.calls[0][0].responseType).toBe('text');
  });
});
