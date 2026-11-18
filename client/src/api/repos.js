import { request } from './client.js';

/** @returns {Promise<{ items: object[] }>} the user's repositories, newest first (spec 6.2). */
export const listRepos = () => request('/repos');

/**
 * Adds a repository and starts ingestion. A failed repository is retried with a new job.
 * @param {string} repo `owner/name` or a github.com URL
 * @returns {Promise<{ repository: object, job: object }>}
 */
export const addRepo = (repo) => request('/repos', { method: 'POST', body: { repo } });

/** @param {number} page */
export const listGithubRepos = (page = 1) => request(`/github/repos?page=${page}`);

/**
 * Deletes a repository and all its data. `409 JOB_ACTIVE` while a job runs.
 * @param {string} id
 * @returns {Promise<null>}
 */
export const deleteRepo = (id) => request(`/repos/${encodeURIComponent(id)}`, { method: 'DELETE' });

/**
 * The repository's dependency graph. `409 GRAPH_NOT_READY` before ingestion succeeded.
 * @param {string} id
 * @returns {Promise<{ repository: object, nodes: object[], edges: object[], unresolved: object }>}
 */
export const getGraph = (id) => request(`/repos/${encodeURIComponent(id)}/graph`);

/**
 * One file's source, fetched from GitHub at the analysed commit. Files over 1 MB come back as
 * `{ tooLarge: true }`.
 * @param {string} id repository id
 * @param {string} nodeId file node id
 * @returns {Promise<{ path: string, language: string, content: string } | { tooLarge: true }>}
 */
export const getSource = (id, nodeId) =>
  request(`/repos/${encodeURIComponent(id)}/nodes/${encodeURIComponent(nodeId)}/source`);
