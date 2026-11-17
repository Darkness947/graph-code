/** Wording from spec 8.5 and 8.9. Use exactly; do not paraphrase. */

/** @param {{ phase?: string | null, filesTotal?: number | null, filesProcessed?: number | null } | null | undefined} job */
export function phaseLabel(job) {
  switch (job?.phase) {
    case 'fetching':
      return 'Downloading repository…';
    case 'extracting':
      return 'Extracting files…';
    case 'parsing':
      return job.filesTotal
        ? `Parsing ${job.filesProcessed ?? 0} / ${job.filesTotal} files…`
        : 'Parsing files…';
    case 'resolving':
      return 'Resolving imports…';
    case 'persisting':
      return 'Saving graph…';
    default:
      return 'Waiting to start…';
  }
}

/** @param {number | null | undefined} filesTotal */
export function tierLine(filesTotal) {
  if (filesTotal > 700) return 'Very large repository. This can take a few minutes.';
  if (filesTotal > 300) return 'Large repository. This can take up to a minute.';
  return null;
}

export const SKIPPED_FILES = (n) => `${n} file(s) couldn't be parsed and were skipped.`;

/** Inline messages for add-repository errors (spec 8.9). Returns null for an unknown code. */
export function addErrorMessage(err) {
  switch (err?.code) {
    case 'VALIDATION_ERROR':
      return 'Enter a repository as owner/name or a github.com link.';
    case 'REPO_NOT_FOUND_ON_GITHUB':
      return "We couldn't find that repository on GitHub. Check the owner and name.";
    case 'REPO_PRIVATE_NOT_SUPPORTED':
      return 'This repository is private. Only public repositories are supported in this version.';
    case 'REPO_ALREADY_ANALYZED':
      return "You've already analyzed this repository.";
    case 'JOB_ACTIVE':
      return 'This repository is already being analyzed.';
    case 'RATE_LIMITED':
      return `You're doing that too often. Try again in ${err.retryAfterSeconds ?? 60} seconds.`;
    case 'GITHUB_UNAVAILABLE':
      return "GitHub isn't responding right now. Try again in a moment.";
    default:
      return GENERIC_ERROR;
  }
}

export const GENERIC_ERROR = 'Something went wrong. Try again.';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (n) => String(n).padStart(2, '0');

/**
 * "12 Nov 2026" or, with `time`, "12 Nov 2026, 10:00" (spec 8.5), in the browser time zone.
 * Months are fixed three-letter names: Intl en-GB prints "Sept".
 */
export function formatDate(iso, { time = false } = {}) {
  const d = new Date(iso);
  const date = `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
  return time ? `${date}, ${pad(d.getHours())}:${pad(d.getMinutes())}` : date;
}

export const SESSION_EXPIRED = 'Your session has expired. Please sign in again.';

/** Inline message for a failed remove (spec 8.9). */
export const removeErrorMessage = (err) =>
  err?.code === 'JOB_ACTIVE' ? addErrorMessage(err) : GENERIC_ERROR;

/** Remove confirmation (spec 8.5). */
export const REMOVE_CONFIRM = (displayName) =>
  `Remove ${displayName}? This deletes its dependency graph and cached AI results from Graph Code. Your repository on GitHub is not affected.`;
export const REPO_REMOVED = 'Repository removed';

/** "1 file", "1,234 files": a count with its noun. */
export const countOf = (n, one, many) => `${n.toLocaleString('en')} ${n === 1 ? one : many}`;
