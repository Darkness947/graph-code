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
