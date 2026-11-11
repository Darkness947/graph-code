import axios from 'axios';

const AUTHORIZE_URL = 'https://github.com/login/oauth/authorize';
const TOKEN_URL = 'https://github.com/login/oauth/access_token';
const USER_URL = 'https://api.github.com/user';
const TIMEOUT_MS = 15000;

/**
 * GitHub OAuth calls (spec 7.2). Every URL is a fixed allowlisted constant; no scope is requested.
 * @param {{ GITHUB_CLIENT_ID: string, GITHUB_CLIENT_SECRET: string, GITHUB_CALLBACK_URL: string }} config
 * @param {import('axios').AxiosInstance} [http] injectable for tests
 */
export function createGithubOAuth(config, http = axios) {
  return {
    /** @param {string} state */
    authorizeUrl(state) {
      const url = new URL(AUTHORIZE_URL);
      url.searchParams.set('client_id', config.GITHUB_CLIENT_ID);
      url.searchParams.set('redirect_uri', config.GITHUB_CALLBACK_URL);
      url.searchParams.set('state', state);
      return url.toString();
    },
    /**
     * @param {string} code
     * @returns {Promise<{ token: string, scopes: string }>}
     * @throws when GitHub rejects the code or the request fails
     */
    async exchangeCode(code) {
      const res = await http.post(
        TOKEN_URL,
        {
          client_id: config.GITHUB_CLIENT_ID,
          client_secret: config.GITHUB_CLIENT_SECRET,
          code,
          redirect_uri: config.GITHUB_CALLBACK_URL,
        },
        { headers: { Accept: 'application/json' }, timeout: TIMEOUT_MS, maxRedirects: 0 },
      );
      const token = res.data?.access_token;
      if (typeof token !== 'string' || token === '') throw new Error('GitHub returned no token');
      return { token, scopes: typeof res.data.scope === 'string' ? res.data.scope : '' };
    },
    /**
     * @param {string} token
     * @returns {Promise<{ id: number, login: string, avatarUrl: string | null }>}
     */
    async fetchUser(token) {
      const res = await http.get(USER_URL, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
        timeout: TIMEOUT_MS,
        maxRedirects: 0,
      });
      const { id, login, avatar_url: avatarUrl } = res.data ?? {};
      if (!Number.isSafeInteger(id) || typeof login !== 'string') {
        throw new Error('GitHub returned an unexpected user');
      }
      return { id, login, avatarUrl: typeof avatarUrl === 'string' ? avatarUrl : null };
    },
  };
}
