import { describe, it, expect, vi } from 'vitest';
import { createGithubOAuth } from '../../src/services/auth/githubOAuth.js';
import { statesMatch } from '../../src/routes/auth.js';

const config = {
  GITHUB_CLIENT_ID: 'cid',
  GITHUB_CLIENT_SECRET: 'csecret',
  GITHUB_CALLBACK_URL: 'http://localhost:5173/api/auth/github/callback',
};

describe('githubOAuth', () => {
  it('builds the authorize URL with client, redirect and state and no scope', () => {
    const url = new URL(createGithubOAuth(config, {}).authorizeUrl('abc'));
    expect(url.origin + url.pathname).toBe('https://github.com/login/oauth/authorize');
    expect(url.searchParams.get('client_id')).toBe('cid');
    expect(url.searchParams.get('redirect_uri')).toBe(config.GITHUB_CALLBACK_URL);
    expect(url.searchParams.get('state')).toBe('abc');
    expect(url.searchParams.has('scope')).toBe(false);
  });

  it('exchanges a code at the fixed GitHub token URL', async () => {
    const http = { post: vi.fn().mockResolvedValue({ data: { access_token: 'tok', scope: '' } }) };
    const out = await createGithubOAuth(config, http).exchangeCode('thecode');
    expect(out).toEqual({ token: 'tok', scopes: '' });
    const [url, body, opts] = http.post.mock.calls[0];
    expect(url).toBe('https://github.com/login/oauth/access_token');
    expect(body).toMatchObject({ client_id: 'cid', client_secret: 'csecret', code: 'thecode' });
    expect(opts.headers.Accept).toBe('application/json');
  });

  it('throws when GitHub answers without a token (e.g. a bad code)', async () => {
    const http = { post: vi.fn().mockResolvedValue({ data: { error: 'bad_verification_code' } }) };
    await expect(createGithubOAuth(config, http).exchangeCode('x')).rejects.toThrow();
  });

  it('fetches the user from api.github.com with a bearer token', async () => {
    const http = {
      get: vi.fn().mockResolvedValue({ data: { id: 7, login: 'octo', avatar_url: 'http://a' } }),
    };
    const user = await createGithubOAuth(config, http).fetchUser('tok');
    expect(user).toEqual({ id: 7, login: 'octo', avatarUrl: 'http://a' });
    expect(http.get.mock.calls[0][0]).toBe('https://api.github.com/user');
    expect(http.get.mock.calls[0][1].headers.Authorization).toBe('Bearer tok');
  });

  it('rejects an unexpected user payload', async () => {
    const http = { get: vi.fn().mockResolvedValue({ data: { login: 'x' } }) };
    await expect(createGithubOAuth(config, http).fetchUser('t')).rejects.toThrow();
  });
});

describe('statesMatch', () => {
  it('is true only for equal strings', () => {
    expect(statesMatch('abc', 'abc')).toBe(true);
    expect(statesMatch('abc', 'abd')).toBe(false);
    expect(statesMatch('abc', 'abcd')).toBe(false);
    expect(statesMatch(undefined, 'abc')).toBe(false);
    expect(statesMatch('abc', undefined)).toBe(false);
    expect(statesMatch('abc', ['abc'])).toBe(false);
  });
});
