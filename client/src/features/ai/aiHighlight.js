/**
 * The AI extension of focus mode (spec 8.6 item 9), as data: which drawn files carry which risk
 * level, which folders must open so they are drawn, and which edges turn red. Paths the graph
 * doesn't know are ignored (the server already drops them; this keeps a stale result harmless).
 */
import { fileIdByPath } from '../graph/graphIndex.js';

/**
 * @param {{ nodesById: Map<string, any> }} index
 * @param {{ risks?: Array<{ path: string, level: string }> } | null | undefined} result
 * @returns {{ levels: Map<string, 'high' | 'medium' | 'low'>, folders: string[] }}
 *   `levels`: file id -> risk level; `folders`: the parent folder of every risk file
 */
export function aiHighlight(index, result) {
  const levels = new Map();
  const folders = new Set();
  const ids = fileIdByPath(index);
  for (const { path, level } of result?.risks ?? []) {
    const id = ids.get(path);
    if (!id || levels.has(id)) continue;
    levels.set(id, level);
    const { parentPath } = index.nodesById.get(id);
    if (parentPath) folders.add(parentPath);
  }
  return { levels, folders: [...folders] };
}

/**
 * Whether an edge joins the analysed file and one of its high-risk files (drawn in
 * `--risk-high`). Edges run importer -> imported, so either end may be the target.
 * @param {{ source: string, target: string }} edge
 * @param {string | null} targetId
 * @param {Map<string, string>} levels from `aiHighlight`
 */
export const isHighRiskEdge = ({ source, target }, targetId, levels) =>
  (source === targetId && levels.get(target) === 'high') ||
  (target === targetId && levels.get(source) === 'high');

/** An `aiByNodeId` entry's result when it succeeded, else null. */
export const successResult = (entry) => (entry?.status === 'success' ? entry.result : null);

/**
 * The AI result for the selected file, or null when it has none.
 * @param {{ selectedNodeId: string | null, aiByNodeId: Record<string, { status: string, result: any }> }} state
 */
export const selectedAiResult = (state) => successResult(state.aiByNodeId[state.selectedNodeId]);

/** Whether any analysis is waiting for the server (the server allows one per user). */
export const analysisInFlight = (state) =>
  Object.values(state.aiByNodeId).some((e) => e.status === 'loading');
