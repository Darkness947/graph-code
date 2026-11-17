import { AppError } from '../../errors/AppError.js';
import { MAX_SOURCE_BYTES } from '../github/githubClient.js';

function notReady() {
  return new AppError('GRAPH_NOT_READY', "This repository's graph isn't ready yet.");
}

function nodeNotFound() {
  return new AppError('NOT_FOUND', 'File not found.');
}

/** `src/lib/utils.ts` → `src/lib`; a top-level item → `""` (the root, spec 6.2). */
export function parentPathOf(path) {
  const slash = path.lastIndexOf('/');
  return slash === -1 ? '' : path.slice(0, slash);
}

/**
 * Maps a node row to the Graph node shape (spec 6.2). Folders carry only `metrics.fileCount`.
 * @param {Record<string, any>} row
 */
export function mapNode(row) {
  const base = {
    id: row.id,
    path: row.path,
    name: row.name,
    type: row.node_type,
    parentPath: parentPathOf(row.path),
  };
  if (row.node_type === 'folder') {
    return { ...base, metrics: { fileCount: row.metrics?.fileCount ?? 0 } };
  }
  return {
    ...base,
    language: row.language,
    sizeBytes: row.size_bytes,
    metrics: { fanIn: row.metrics?.fanIn ?? 0, fanOut: row.metrics?.fanOut ?? 0 },
  };
}

/**
 * Graph and source queries (spec 6.2, 7.6). Unknown repositories, another user's, and nodes that
 * are not files of that repository all give NOT_FOUND. Source code is fetched from GitHub at the
 * analyzed `commit_sha` and never stored.
 * @param {{ repos: { get: (userId: string, repoId: string) => Promise<Record<string, any>> },
 *   graphs: ReturnType<typeof import('./graphRepository.js').createGraphRepository>,
 *   github: { getFileSource: (token: string, owner: string, name: string, path: string, sha: string) => Promise<string> },
 *   getToken: (userId: string) => Promise<string> }} deps
 */
export function createGraphQueryService({ repos, graphs, github, getToken }) {
  /** @returns {Promise<Record<string, any>>} the Repository; throws NOT_FOUND or GRAPH_NOT_READY */
  async function readyRepository(userId, repoId) {
    const repository = await repos.get(userId, repoId);
    if (repository.status !== 'ready') throw notReady();
    return repository;
  }

  /**
   * @param {string} userId
   * @param {string} repoId
   * @returns {Promise<object>} the Graph object (spec 6.2)
   */
  async function getGraph(userId, repoId) {
    const repository = await readyRepository(userId, repoId);
    const { nodes, edges, unresolved } = await graphs.readGraph(userId, repoId);
    return { repository, nodes: nodes.map(mapNode), edges, unresolved };
  }

  /**
   * @param {string} userId
   * @param {string} repoId
   * @param {string} nodeId
   * @returns {Promise<{ path: string, language: string | null, content: string } | { tooLarge: true }>}
   */
  async function getSource(userId, repoId, nodeId) {
    const repository = await readyRepository(userId, repoId);
    const node = await graphs.findNode(userId, repoId, nodeId);
    if (!node || node.nodeType !== 'file') throw nodeNotFound();
    if (node.sizeBytes > MAX_SOURCE_BYTES) return { tooLarge: true };

    const token = await getToken(userId);
    let content;
    try {
      content = await github.getFileSource(
        token,
        repository.owner,
        repository.name,
        node.path,
        node.commitSha,
      );
    } catch (err) {
      // GitHub's copy can exceed the limit even when the stored size did not (spec 6.2).
      if (err instanceof AppError && err.githubReason === 'TOO_LARGE') return { tooLarge: true };
      throw err;
    }
    return { path: node.path, language: node.language, content };
  }

  return { getGraph, getSource };
}
