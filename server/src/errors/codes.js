/**
 * Error codes and their HTTP statuses (spec Part 6.1).
 * @type {Readonly<Record<string, number>>}
 */
export const ERROR_STATUS = Object.freeze({
  VALIDATION_ERROR: 400,
  UNAUTHENTICATED: 401,
  NOT_FOUND: 404,
  REPO_NOT_FOUND_ON_GITHUB: 404,
  REPO_PRIVATE_NOT_SUPPORTED: 422,
  REPO_ALREADY_ANALYZED: 409,
  JOB_ACTIVE: 409,
  GRAPH_NOT_READY: 409,
  RATE_LIMITED: 429,
  AI_QUOTA_EXCEEDED: 429,
  AI_TIMEOUT: 504,
  AI_UNREACHABLE: 502,
  AI_MALFORMED: 502,
  GITHUB_UNAVAILABLE: 502,
  INTERNAL: 500,
});

/** Ingestion failure codes, reported on the job (spec 6.1), not as HTTP errors. */
export const INGESTION_ERROR_CODES = Object.freeze([
  'DOWNLOAD_FAILED',
  'ARCHIVE_INVALID',
  'ARCHIVE_LIMIT_EXCEEDED',
  'REPO_TOO_LARGE',
  'NO_SUPPORTED_FILES',
  'PERSIST_FAILED',
  'INTERRUPTED',
  'INTERNAL',
]);

/** User-facing message for each ingestion failure code (spec 8.9, exact wording). */
export const INGESTION_ERROR_MESSAGES = Object.freeze({
  DOWNLOAD_FAILED: "We couldn't download this repository from GitHub. Try again in a moment.",
  ARCHIVE_INVALID: "This repository's archive is too large or couldn't be read safely.",
  ARCHIVE_LIMIT_EXCEEDED: "This repository's archive is too large or couldn't be read safely.",
  REPO_TOO_LARGE:
    'This repository has more than 1,000 JavaScript/TypeScript files, which is above the current limit.',
  NO_SUPPORTED_FILES: 'No JavaScript or TypeScript files were found in this repository.',
  PERSIST_FAILED: 'Something went wrong while saving the graph. Try again.',
  INTERRUPTED: 'Analysis was interrupted by a server restart. Try again.',
  INTERNAL: 'Something went wrong while saving the graph. Try again.',
});
