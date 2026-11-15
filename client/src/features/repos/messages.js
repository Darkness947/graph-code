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

const DATE_ONLY = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});
const DATE_TIME = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

/** "12 Nov 2026" or, with `time`, "12 Nov 2026, 10:00" (browser time zone). */
export const formatDate = (iso, { time = false } = {}) =>
  (time ? DATE_TIME : DATE_ONLY).format(new Date(iso));

export const SESSION_EXPIRED = 'Your session has expired. Please sign in again.';
