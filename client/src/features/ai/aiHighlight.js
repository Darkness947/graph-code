/**
 * The AI extension of focus mode (spec 8.6 item 9), as data: which drawn files carry which risk
 * level, and which folders must open so they are drawn. Paths the graph doesn't know are
 * ignored (the server already drops them; this keeps a stale result harmless).
 */

/**
 * @param {{ nodesById: Map<string, any> }} index
 * @param {{ risks?: Array<{ path: string, level: string }> } | null | undefined} result
 * @returns {{ levels: Map<string, 'high' | 'medium' | 'low'>, folders: string[] }}
 *   `levels`: file id -> risk level; `folders`: the parent folder of every risk file
 */
export function aiHighlight(index, result) {
  const levels = new Map();
  const folders = new Set();
  if (!result?.risks?.length) return { levels, folders: [] };
  const byPath = new Map();
  for (const node of index.nodesById.values())
    if (node.type === 'file') byPath.set(node.path, node);
  for (const { path, level } of result.risks) {
    const node = byPath.get(path);
    if (!node || levels.has(node.id)) continue;
    levels.set(node.id, level);
    if (node.parentPath) folders.add(node.parentPath);
  }
  return { levels, folders: [...folders] };
}

/**
 * The AI result for the selected file, or null when it has none.
 * @param {{ selectedNodeId: string | null, aiByNodeId: Record<string, { status: string, result: any }> }} state
 */
export const selectedAiResult = (state) => {
  const entry = state.aiByNodeId[state.selectedNodeId];
  return entry?.status === 'success' ? entry.result : null;
};

/** Whether any analysis is waiting for the server (the server allows one per user). */
export const analysisInFlight = (state) =>
  Object.values(state.aiByNodeId).some((e) => e.status === 'loading');
