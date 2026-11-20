import { request } from './client.js';

/**
 * Predicts which files a change to one file affects (spec 6.2, `AnalysisResult`).
 * @param {string} repoId repository id
 * @param {string} nodeId file node id
 * @returns {Promise<{ mode: string, targetPath: string, cached: boolean, generatedAt: string,
 *   noDependents: boolean, dependents: Array<{ path: string, distance: number }>, summary: string,
 *   risks: Array<{ path: string, level: 'high' | 'medium' | 'low', reason: string }>, removedCount: number }>}
 */
export const analyzeFile = (repoId, nodeId) =>
  request(`/repos/${encodeURIComponent(repoId)}/analyze`, {
    method: 'POST',
    body: { mode: 'blast_radius', nodeId },
  });

/** Records that the user has read the AI notice (spec 8.6). @returns {Promise<null>} */
export const acknowledgeAiNotice = () => request('/me/ai-notice', { method: 'POST' });
