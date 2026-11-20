import { analyzeFile } from '../../api/ai.js';
import { useWorkspaceStore } from '../../store/workspaceStore.js';
import { handleUnauthenticated } from '../repos/useRepositories.js';
import { analysisInFlight } from './aiHighlight.js';

/**
 * Runs a blast-radius analysis of file `nodeId` and records the outcome in the workspace store.
 * Does nothing while another analysis is in flight (the server allows one per user). A 401
 * ends the session (spec 8.9) instead of showing an error.
 * @param {string} repoId
 * @param {string} nodeId
 */
export async function runAnalysis(repoId, nodeId) {
  const store = useWorkspaceStore.getState();
  if (analysisInFlight(store)) return;
  const { graph } = store;
  store.startAnalysis(nodeId);
  try {
    const result = await analyzeFile(repoId, nodeId);
    useWorkspaceStore.getState().finishAnalysis(nodeId, result, graph);
  } catch (err) {
    if (handleUnauthenticated(err)) return;
    useWorkspaceStore.getState().failAnalysis(nodeId, err, graph);
  }
}
