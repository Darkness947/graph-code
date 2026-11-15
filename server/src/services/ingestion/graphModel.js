import { randomUUID } from 'node:crypto';
import { encodePathLtree } from './ltree.js';

/**
 * @typedef {object} GraphNode a row for `nodes` (spec 5.2)
 * @property {string} id UUID (D-04), generated here so edges can reference it before insert
 * @property {string} path
 * @property {string} pathLtree spec 5.3
 * @property {string} name last path segment
 * @property {'file' | 'folder'} nodeType
 * @property {string | null} language
 * @property {string | null} contentHash
 * @property {number | null} sizeBytes
 * @property {string[] | null} exports
 * @property {{ fanIn: number, fanOut: number } | { fileCount: number }} metrics
 *
 * @typedef {object} GraphModel
 * @property {GraphNode[]} nodes sorted by path
 * @property {{ source: string, target: string }[]} edges node ids, importer -> imported
 * @property {{ sourceNodeId: string, rawSpecifier: string, reason: string }[]} unresolved
 * @property {Record<string, number>} languageSummary file count per language
 * @property {{ skippedFiles: { path: string, reason: string }[], unresolvedCount: number }} report
 *   the job report (spec 6.2 Job)
 */

const byPath = (a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
const lastSegment = (path) => path.slice(path.lastIndexOf('/') + 1);

/**
 * Turns a file graph into the rows the persisting step writes (spec 7.5 step 5): a folder node
 * for every ancestor folder of a file (the root `""` is not a node), `fanIn` and `fanOut` per
 * file, and `fileCount` per folder, counting every file anywhere beneath it.
 * @param {import('./graphBuilder.js').FileGraph} fileGraph
 * @param {{ newId?: () => string }} [deps]
 * @returns {GraphModel}
 */
export function buildGraphModel(
  { files, edges, unresolved, skipped },
  { newId = randomUUID } = {},
) {
  const fanIn = new Map();
  const fanOut = new Map();
  for (const { from, to } of edges) {
    fanOut.set(from, (fanOut.get(from) ?? 0) + 1);
    fanIn.set(to, (fanIn.get(to) ?? 0) + 1);
  }

  const fileCount = new Map();
  for (const { path } of files) {
    for (let at = path.indexOf('/'); at !== -1; at = path.indexOf('/', at + 1)) {
      const folder = path.slice(0, at);
      fileCount.set(folder, (fileCount.get(folder) ?? 0) + 1);
    }
  }

  /** @type {GraphNode[]} */
  const nodes = [];
  for (const [path, count] of fileCount) {
    nodes.push({
      id: newId(),
      path,
      pathLtree: encodePathLtree(path),
      name: lastSegment(path),
      nodeType: 'folder',
      language: null,
      contentHash: null,
      sizeBytes: null,
      exports: null,
      metrics: { fileCount: count },
    });
  }
  const languageSummary = {};
  for (const file of files) {
    nodes.push({
      id: newId(),
      path: file.path,
      pathLtree: encodePathLtree(file.path),
      name: lastSegment(file.path),
      nodeType: 'file',
      language: file.language,
      contentHash: file.contentHash,
      sizeBytes: file.sizeBytes,
      exports: file.exports,
      metrics: { fanIn: fanIn.get(file.path) ?? 0, fanOut: fanOut.get(file.path) ?? 0 },
    });
    languageSummary[file.language] = (languageSummary[file.language] ?? 0) + 1;
  }
  nodes.sort(byPath);

  const idOf = new Map(nodes.map((n) => [n.path, n.id]));
  return {
    nodes,
    edges: edges.map(({ from, to }) => ({ source: idOf.get(from), target: idOf.get(to) })),
    unresolved: unresolved.map(({ sourcePath, specifier, reason }) => ({
      sourceNodeId: idOf.get(sourcePath),
      rawSpecifier: specifier,
      reason,
    })),
    languageSummary,
    report: { skippedFiles: skipped, unresolvedCount: unresolved.length },
  };
}
