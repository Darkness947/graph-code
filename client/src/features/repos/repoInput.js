const OWNER_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const NAME_RE = /^[A-Za-z0-9._-]{1,100}$/;

/**
 * Parses `owner/name` or a `https://github.com/owner/name` link with the same rules as the
 * server (spec 7.1). Returns null when the input is not acceptable.
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
