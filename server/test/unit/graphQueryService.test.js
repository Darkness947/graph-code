import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AppError } from '../../src/errors/AppError.js';
import {
  createGraphQueryService,
  mapNode,
  parentPathOf,
} from '../../src/services/graph/graphQueryService.js';
import { MAX_SOURCE_BYTES } from '../../src/services/github/githubClient.js';

const SHA = 'a'.repeat(40);
const USER = 'user-1';
const REPO = 'repo-1';
const NODE = 'node-1';
const READY_REPO = {
  id: REPO,
  owner: 'darkness947',
  name: 'vigilante-resume-tailor',
  status: 'ready',
};

const fileNode = (over = {}) => ({
  path: 'src/lib/utils.ts',
  nodeType: 'file',
  language: 'ts',
  sizeBytes: 2048,
  commitSha: SHA,
  ...over,
});

function setup() {
  const repos = { get: vi.fn().mockResolvedValue(READY_REPO) };
  const graphs = {
    readGraph: vi
      .fn()
      .mockResolvedValue({ nodes: [], edges: [], unresolved: { count: 0, items: [] } }),
    findNode: vi.fn().mockResolvedValue(fileNode()),
  };
  const github = { getFileSource: vi.fn().mockResolvedValue('export const x = 1;\n') };
  const getToken = vi.fn().mockResolvedValue('gho_token');
  const service = createGraphQueryService({ repos, graphs, github, getToken });
  return { repos, graphs, github, getToken, service };
}

function githubError(reason) {
  const err = new AppError('GITHUB_UNAVAILABLE', "GitHub isn't responding right now.");
  err.githubReason = reason;
  return err;
}

describe('parentPathOf', () => {
  it.each([
    ['src/lib/utils.ts', 'src/lib'],
    ['src', ''],
    ['index.js', ''],
    ['a/b', 'a'],
  ])('%s → %j', (path, parent) => {
    expect(parentPathOf(path)).toBe(parent);
  });
});

describe('mapNode', () => {
  it('maps a file node to the spec 6.2 shape', () => {
    expect(
      mapNode({
        id: 'f1',
        path: 'src/lib/utils.ts',
        name: 'utils.ts',
        node_type: 'file',
        language: 'ts',
        size_bytes: 2048,
        metrics: { fanIn: 14, fanOut: 2 },
      }),
    ).toEqual({
      id: 'f1',
      path: 'src/lib/utils.ts',
      name: 'utils.ts',
      type: 'file',
      parentPath: 'src/lib',
      language: 'ts',
      sizeBytes: 2048,
      metrics: { fanIn: 14, fanOut: 2 },
    });
  });

  it('maps a folder node with only metrics.fileCount', () => {
    expect(
      mapNode({
        id: 'd1',
        path: 'src',
        name: 'src',
        node_type: 'folder',
        language: null,
        size_bytes: null,
        metrics: { fileCount: 9 },
      }),
    ).toEqual({
      id: 'd1',
      path: 'src',
      name: 'src',
      type: 'folder',
      parentPath: '',
      metrics: { fileCount: 9 },
    });
  });
});

describe('GraphQueryService.getGraph', () => {
  let ctx;
  beforeEach(() => {
    ctx = setup();
  });

  it('returns repository, mapped nodes, edges and unresolved', async () => {
    ctx.graphs.readGraph.mockResolvedValue({
      nodes: [
        { id: 'd1', path: 'src', name: 'src', node_type: 'folder', metrics: { fileCount: 1 } },
      ],
      edges: [{ id: 1, source: 'a', target: 'b' }],
      unresolved: { count: 1, items: [{ sourcePath: 'x', specifier: 'y', reason: 'z' }] },
    });
    const graph = await ctx.service.getGraph(USER, REPO);
    expect(Object.keys(graph)).toEqual(['repository', 'nodes', 'edges', 'unresolved']);
    expect(graph.repository).toEqual(READY_REPO);
    expect(graph.nodes[0].type).toBe('folder');
    expect(graph.edges).toEqual([{ id: 1, source: 'a', target: 'b' }]);
    expect(ctx.graphs.readGraph).toHaveBeenCalledWith(USER, REPO);
  });

  it.each(['pending', 'analyzing', 'failed'])(
    'throws GRAPH_NOT_READY while the repository is %s',
    async (status) => {
      ctx.repos.get.mockResolvedValue({ ...READY_REPO, status });
      await expect(ctx.service.getGraph(USER, REPO)).rejects.toMatchObject({
        code: 'GRAPH_NOT_READY',
        status: 409,
      });
      expect(ctx.graphs.readGraph).not.toHaveBeenCalled();
    },
  );

  it('passes NOT_FOUND through for an unknown or foreign repository', async () => {
    ctx.repos.get.mockRejectedValue(new AppError('NOT_FOUND', 'Repository not found.'));
    await expect(ctx.service.getGraph(USER, REPO)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('GraphQueryService.getSource', () => {
  let ctx;
  beforeEach(() => {
    ctx = setup();
  });

  it('fetches the file from GitHub at the analyzed commit_sha', async () => {
    const result = await ctx.service.getSource(USER, REPO, NODE);
    expect(result).toEqual({
      path: 'src/lib/utils.ts',
      language: 'ts',
      content: 'export const x = 1;\n',
    });
    expect(ctx.graphs.findNode).toHaveBeenCalledWith(USER, REPO, NODE);
    expect(ctx.github.getFileSource).toHaveBeenCalledExactlyOnceWith(
      'gho_token',
      'darkness947',
      'vigilante-resume-tailor',
      'src/lib/utils.ts',
      SHA,
    );
  });

  it('returns {tooLarge: true} without calling GitHub when the stored size is over 1 MB', async () => {
    ctx.graphs.findNode.mockResolvedValue(fileNode({ sizeBytes: MAX_SOURCE_BYTES + 1 }));
    expect(await ctx.service.getSource(USER, REPO, NODE)).toEqual({ tooLarge: true });
    expect(ctx.github.getFileSource).not.toHaveBeenCalled();
  });

  it('still fetches a file of exactly 1 MB', async () => {
    ctx.graphs.findNode.mockResolvedValue(fileNode({ sizeBytes: MAX_SOURCE_BYTES }));
    await ctx.service.getSource(USER, REPO, NODE);
    expect(ctx.github.getFileSource).toHaveBeenCalledOnce();
  });

  it('returns {tooLarge: true} when GitHub reports TOO_LARGE', async () => {
    ctx.github.getFileSource.mockRejectedValue(githubError('TOO_LARGE'));
    expect(await ctx.service.getSource(USER, REPO, NODE)).toEqual({ tooLarge: true });
  });

  it('passes other GitHub failures through', async () => {
    ctx.github.getFileSource.mockRejectedValue(githubError('SERVER'));
    await expect(ctx.service.getSource(USER, REPO, NODE)).rejects.toMatchObject({
      code: 'GITHUB_UNAVAILABLE',
      githubReason: 'SERVER',
    });
  });

  it('throws NOT_FOUND for a node that is not in this repository', async () => {
    ctx.graphs.findNode.mockResolvedValue(null);
    await expect(ctx.service.getSource(USER, REPO, NODE)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(ctx.github.getFileSource).not.toHaveBeenCalled();
  });

  it('throws NOT_FOUND for a folder node', async () => {
    ctx.graphs.findNode.mockResolvedValue(fileNode({ nodeType: 'folder', sizeBytes: null }));
    await expect(ctx.service.getSource(USER, REPO, NODE)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('throws GRAPH_NOT_READY before ingestion succeeded, without looking up the node', async () => {
    ctx.repos.get.mockResolvedValue({ ...READY_REPO, status: 'analyzing' });
    await expect(ctx.service.getSource(USER, REPO, NODE)).rejects.toMatchObject({
      code: 'GRAPH_NOT_READY',
    });
    expect(ctx.graphs.findNode).not.toHaveBeenCalled();
    expect(ctx.getToken).not.toHaveBeenCalled();
  });

  it('passes UNAUTHENTICATED through when the user has no usable token', async () => {
    ctx.getToken.mockRejectedValue(new AppError('UNAUTHENTICATED', 'Please sign in to continue.'));
    await expect(ctx.service.getSource(USER, REPO, NODE)).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });
  });
});
