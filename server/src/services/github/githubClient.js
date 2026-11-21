import axios from 'axios';
import { AppError } from '../../errors/AppError.js';

/** Spec 7.4: the only hosts this client may ever contact. */
export const ALLOWED_HOSTS = Object.freeze(['github.com', 'api.github.com', 'codeload.github.com']);

const API_TIMEOUT_MS = 15000;
const ZIP_TIMEOUT_MS = 60000;
const MAX_REDIRECTS = 3;
/** Probed to confirm that GitHub really rejects a token. */
const USER_URL = 'https://api.github.com/user';
/** Largest file source fetched from GitHub (spec 6.2). */
export const MAX_SOURCE_BYTES = 1024 * 1024;

const OWNER_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const NAME_RE = /^[A-Za-z0-9._-]{1,100}$/;
const SHA_RE = /^[0-9a-f]{40}$/;

/**
 * Throws unless the URL is https on an allowlisted host (default port, no credentials).
 * @param {string | URL} input
 * @returns {URL}
 */
export function assertAllowedUrl(input) {
  // URL parsing drops an explicit default port (":443"), so check the raw text first.
  if (typeof input === 'string' && hasExplicitAuthorityExtras(input)) throw blocked();
  let url;
  try {
    url = new URL(input);
  } catch {
    throw blocked();
  }
  if (
    url.protocol !== 'https:' ||
    !ALLOWED_HOSTS.includes(url.hostname) ||
    url.port !== '' ||
    url.username !== '' ||
    url.password !== ''
  ) {
    throw blocked();
  }
  return url;
}

/** True when the authority part of an absolute or protocol-relative URL contains ":" (port or password). */
function hasExplicitAuthorityExtras(text) {
  const authority = /^(?:[a-z][a-z0-9+.-]*:)?\/\/([^/?#]*)/i.exec(text)?.[1];
  return authority !== undefined && authority.includes(':');
}

function blocked() {
  const err = new AppError('GITHUB_UNAVAILABLE', 'GitHub request was blocked.');
  err.githubReason = 'BLOCKED';
  return err;
}

function invalid(what) {
  return new AppError('VALIDATION_ERROR', `Invalid ${what}.`);
}

function checkOwnerName(owner, name) {
  if (typeof owner !== 'string' || !OWNER_RE.test(owner)) throw invalid('repository owner');
  if (typeof name !== 'string' || !NAME_RE.test(name) || name === '.' || name === '..') {
    throw invalid('repository name');
  }
}

/** Encodes a slash-separated path segment by segment; rejects empty, `.` and `..` segments. */
function encodePath(value, what) {
  if (typeof value !== 'string' || value === '') throw invalid(what);
  const segments = value.split('/');
  if (segments.some((s) => s === '' || s === '.' || s === '..')) throw invalid(what);
  return segments.map(encodeURIComponent).join('/');
}

function checkSha(sha) {
  if (typeof sha !== 'string' || !SHA_RE.test(sha)) throw invalid('commit SHA');
}

/** GitHub refused the user's token (revoked or reset): the session cannot be used any more. */
function tokenRejected() {
  const err = new AppError('UNAUTHENTICATED', 'Please sign in to continue.');
  err.githubReason = 'TOKEN_REJECTED';
  err.githubStatus = 401;
  return err;
}

function unavailable(reason, status) {
  const err = new AppError('GITHUB_UNAVAILABLE', "GitHub isn't responding right now.");
  err.githubReason = reason;
  err.githubStatus = status;
  return err;
}

/**
 * GitHub client (spec 7.4). Every URL is checked against the allowlist before it is sent,
 * redirects are followed by hand (max 3, each target re-checked), and a failed attempt is
 * retried once on network errors, 5xx and an unconfirmed 401, never on other 4xx. Tokens and
 * headers are never logged.
 *
 * Failures are `AppError`s: `REPO_NOT_FOUND_ON_GITHUB` for 404, `UNAUTHENTICATED` for a 401 on a
 * request that carried the user's token once `GET /user` confirms the token is rejected,
 * `GITHUB_UNAVAILABLE` otherwise. An unconfirmed 401 is retried once, like a 5xx.
 * `err.githubReason` is one of `NETWORK`, `SERVER`, `CLIENT`, `REDIRECT`, `BLOCKED`, `TOO_LARGE`,
 * `TOKEN_REJECTED`, `TOKEN_UNCONFIRMED`.
 *
 * @param {{ maxZipBytes: number }} options
 * @param {{ request: Function }} [http] axios-compatible; injectable for tests
 */
export function createGithubClient({ maxZipBytes }, http = axios) {
  /**
   * One attempt, following redirects manually. Returns the final response, and whether the
   * token was sent with it, or throws.
   */
  async function attempt(startUrl, opts) {
    let url = assertAllowedUrl(startUrl);
    const origin = url.hostname;
    let sendToken = true;
    for (let hops = 0; ; hops++) {
      const headers = { ...opts.headers };
      if (url.hostname !== origin) sendToken = false;
      if (!sendToken) delete headers.Authorization;
      const res = await http.request({
        method: 'GET',
        url: url.toString(),
        headers,
        timeout: opts.timeout,
        maxRedirects: 0,
        validateStatus: () => true,
        responseType: opts.responseType,
        maxContentLength: opts.maxContentLength,
        maxBodyLength: opts.maxContentLength,
        transformResponse: [(d) => d],
      });
      if (res.status >= 300 && res.status < 400 && res.headers?.location) {
        if (hops >= MAX_REDIRECTS) throw unavailable('REDIRECT', res.status);
        const location = String(res.headers.location);
        if (hasExplicitAuthorityExtras(location)) throw blocked();
        url = assertAllowedUrl(new URL(location, url));
        continue;
      }
      return { res, sentToken: sendToken && Boolean(headers.Authorization) };
    }
  }

  /**
   * A single 401 is not proof that the token is dead (GitHub occasionally answers 401 for a
   * valid token). Asks `GET /user` with the same token: true only when that is also a 401 to a
   * request that still carried the token. Any other outcome (2xx, 5xx, network error, a redirect
   * that dropped the token) is not a confirmation. The probe itself is never retried.
   */
  async function confirmTokenRejected(authorization) {
    try {
      const { res, sentToken } = await attempt(USER_URL, {
        timeout: API_TIMEOUT_MS,
        headers: { Accept: 'application/vnd.github+json', Authorization: authorization },
      });
      return sentToken && res.status === 401;
    } catch {
      return false;
    }
  }

  async function request(url, opts) {
    let lastReason = 'NETWORK';
    let lastStatus;
    for (let tryNo = 0; tryNo < 2; tryNo++) {
      let res;
      let sentToken;
      try {
        ({ res, sentToken } = await attempt(url, opts));
      } catch (err) {
        if (err instanceof AppError) throw err; // blocked / redirect limit: never retried
        if (/maxContentLength|maxBodyLength/i.test(String(err?.message))) {
          throw unavailable('TOO_LARGE');
        }
        lastReason = 'NETWORK';
        lastStatus = undefined;
        continue;
      }
      if (res.status >= 200 && res.status < 300) return res.data;
      if (res.status >= 500) {
        lastReason = 'SERVER';
        lastStatus = res.status;
        continue;
      }
      if (res.status === 404) {
        throw new AppError(
          'REPO_NOT_FOUND_ON_GITHUB',
          "We couldn't find that repository on GitHub. Check the owner and name.",
        );
      }
      if (res.status === 401 && sentToken) {
        if (await confirmTokenRejected(opts.headers.Authorization)) throw tokenRejected();
        // Not confirmed: retry once, like a 5xx. An unconfirmed 401 never ends the session.
        lastReason = 'TOKEN_UNCONFIRMED';
        lastStatus = 401;
        continue;
      }
      throw unavailable('CLIENT', res.status);
    }
    throw unavailable(lastReason, lastStatus);
  }

  const api = (url, token, accept, extra = {}) =>
    request(url, {
      timeout: API_TIMEOUT_MS,
      headers: { Accept: accept, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      ...extra,
    });

  const json = (data) => {
    if (typeof data !== 'string') return data;
    try {
      return JSON.parse(data);
    } catch {
      throw unavailable('CLIENT');
    }
  };

  return {
    /**
     * @returns {Promise<{ id: number, private: boolean, defaultBranch: string, owner: string, name: string }>}
     */
    async getRepository(token, owner, name) {
      checkOwnerName(owner, name);
      const data = json(
        await api(
          `https://api.github.com/repos/${owner}/${name}`,
          token,
          'application/vnd.github+json',
        ),
      );
      if (
        !Number.isSafeInteger(data?.id) ||
        typeof data.private !== 'boolean' ||
        typeof data.default_branch !== 'string' ||
        typeof data.owner?.login !== 'string' ||
        typeof data.name !== 'string'
      ) {
        throw unavailable('CLIENT');
      }
      return {
        id: data.id,
        private: data.private,
        defaultBranch: data.default_branch,
        owner: data.owner.login,
        name: data.name,
      };
    },

    /** @returns {Promise<string>} the 40-character head commit SHA */
    async getHeadCommit(token, owner, name, branch) {
      checkOwnerName(owner, name);
      const ref = encodePath(branch, 'branch');
      const text = await api(
        `https://api.github.com/repos/${owner}/${name}/commits/${ref}`,
        token,
        'application/vnd.github.sha',
        { responseType: 'text' },
      );
      const sha = String(text).trim();
      if (!SHA_RE.test(sha)) throw unavailable('CLIENT');
      return sha;
    },

    /** Sends no token. @returns {Promise<Buffer>} */
    async downloadArchive(owner, name, sha) {
      checkOwnerName(owner, name);
      checkSha(sha);
      const data = await request(`https://codeload.github.com/${owner}/${name}/zip/${sha}`, {
        timeout: ZIP_TIMEOUT_MS,
        headers: {},
        responseType: 'arraybuffer',
        maxContentLength: maxZipBytes,
      });
      return Buffer.isBuffer(data) ? data : Buffer.from(data);
    },

    /** @returns {Promise<string>} raw file text (`TOO_LARGE` reason when over 1 MB) */
    async getFileSource(token, owner, name, path, sha) {
      checkOwnerName(owner, name);
      checkSha(sha);
      const filePath = encodePath(path, 'file path');
      const data = await api(
        `https://api.github.com/repos/${owner}/${name}/contents/${filePath}?ref=${sha}`,
        token,
        'application/vnd.github.raw',
        { responseType: 'text', maxContentLength: MAX_SOURCE_BYTES },
      );
      return String(data);
    },

    /** @param {number} page 1-based */
    async listUserRepositories(token, page) {
      if (!Number.isSafeInteger(page) || page < 1) throw invalid('page');
      const data = json(
        await api(
          `https://api.github.com/user/repos?visibility=public&affiliation=owner,collaborator,organization_member&sort=updated&per_page=30&page=${page}`,
          token,
          'application/vnd.github+json',
        ),
      );
      if (!Array.isArray(data)) throw unavailable('CLIENT');
      return data;
    },
  };
}
