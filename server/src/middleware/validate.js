import { body, param } from 'express-validator';

/** GitHub owner: letters, digits and hyphens, at most 39 characters (spec 7.1). */
export const OWNER_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
/** GitHub repository name (spec 7.1). */
export const NAME_RE = /^[A-Za-z0-9._-]{1,100}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * @param {unknown} value
 * @returns {boolean}
 */
export function isUuid(value) {
  return typeof value === 'string' && UUID_RE.test(value);
}

/**
 * Parses `owner/name` or a `https://github.com/owner/name` URL. URLs are accepted only with
 * host `github.com`. Returns null when the input is not acceptable.
 * @param {unknown} input
 * @returns {{ owner: string, name: string } | null}
 */
export function parseRepoInput(input) {
  if (typeof input !== 'string') return null;
  const text = input.trim();
  let owner;
  let name;
  if (/^https?:\/\//i.test(text)) {
    let url;
    try {
      url = new URL(text);
    } catch {
      return null;
    }
    if (url.protocol !== 'https:' || url.hostname !== 'github.com') return null;
    if (url.username || url.password || url.port) return null;
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts.length < 2) return null;
    [owner, name] = parts;
  } else {
    const parts = text.split('/');
    if (parts.length !== 2) return null;
    [owner, name] = parts;
  }
  if (name.endsWith('.git')) name = name.slice(0, -4);
  if (!OWNER_RE.test(owner) || !NAME_RE.test(name) || name === '.' || name === '..') return null;
  return { owner, name };
}

/**
 * express-validator chain for a UUID route parameter, e.g. `:id`.
 * @param {string} name
 */
export const uuidParam = (name) => param(name).custom(isUuid).withMessage(`${name} must be a UUID`);

/** express-validator chain for the `repo` field of `POST /api/repos`. */
export const repoInputBody = () =>
  body('repo')
    .custom((value) => parseRepoInput(value) !== null)
    .withMessage('repo must be owner/name or a https://github.com/owner/name URL');
