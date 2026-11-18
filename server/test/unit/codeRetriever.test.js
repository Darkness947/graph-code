import { describe, it, expect, vi } from 'vitest';
import {
  createCodeRetriever,
  mapWithConcurrency,
  EXCERPT_LIMITS,
} from '../../src/services/ai/codeRetriever.js';
import { MAX_SOURCE_BYTES } from '../../src/services/github/githubClient.js';
import {
  nearestDependents,
  createSubgraphExtractor,
  MAX_SUBGRAPH_DEPENDENTS,
} from '../../src/services/ai/subgraphExtractor.js';

const dep = (i, extra = {}) => ({
  path: `src/d${String(i).padStart(2, '0')}.ts`,
  sizeBytes: 10,
  ...extra,
});
const input = (dependents, target = { path: 'src/target.ts', sizeBytes: 10 }) => ({
  token: 'gho_x',
  owner: 'o',
  name: 'n',
  commitSha: 'c'.repeat(40),
  target,
  dependents,
});

describe('CodeRetriever (spec 7.7 step 6)', () => {
  it('fetches the target and the 10 nearest dependents at commit_sha, target first', async () => {
    const github = { getFileSource: vi.fn(async (t, o, n, path) => `// ${path}`) };
    const out = await createCodeRetriever(github).retrieve(
      input(Array.from({ length: 15 }, (_, i) => dep(i))),
    );
    expect(out).toHaveLength(11);
    expect(out[0]).toEqual({ path: 'src/target.ts', text: '// src/target.ts' });
    expect(out.at(-1).path).toBe('src/d09.ts');
    expect(github.getFileSource).toHaveBeenCalledWith(
      'gho_x',
      'o',
      'n',
      'src/target.ts',
      'c'.repeat(40),
    );
  });

  it('caps the target at 12,000 characters, dependents at 3,000 and the total at 40,000', async () => {
    const github = { getFileSource: vi.fn(async () => 'x'.repeat(50000)) };
    const out = await createCodeRetriever(github).retrieve(
      input(Array.from({ length: 10 }, (_, i) => dep(i))),
    );
    expect(out[0].text).toHaveLength(EXCERPT_LIMITS.targetChars);
    expect(out[1].text).toHaveLength(EXCERPT_LIMITS.dependentChars);
    const total = out.reduce((n, e) => n + e.text.length, 0);
    expect(total).toBe(EXCERPT_LIMITS.totalChars);
    // 12,000 + 9 × 3,000 = 39,000, so the tenth dependent gets only the last 1,000.
    expect(out).toHaveLength(11);
    expect(out[10].text).toHaveLength(1000);
  });

  it('never has more than 4 requests in flight', async () => {
    let inFlight = 0;
    let peak = 0;
    const github = {
      getFileSource: vi.fn(async () => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((r) => setTimeout(r, 5));
        inFlight -= 1;
        return 'code';
      }),
    };
    await createCodeRetriever(github).retrieve(input(Array.from({ length: 10 }, (_, i) => dep(i))));
    expect(github.getFileSource).toHaveBeenCalledTimes(11);
    expect(peak).toBe(EXCERPT_LIMITS.concurrency);
  });

  it('leaves out files that fail or are too large, without failing', async () => {
    const github = {
      getFileSource: vi.fn(async (t, o, n, path) => {
        if (path === 'src/d00.ts') throw new Error('GitHub down');
        return 'ok';
      }),
    };
    const out = await createCodeRetriever(github).retrieve(
      input([dep(0), dep(1, { sizeBytes: MAX_SOURCE_BYTES + 1 }), dep(2)]),
    );
    expect(out.map((e) => e.path)).toEqual(['src/target.ts', 'src/d02.ts']);
    expect(github.getFileSource).toHaveBeenCalledTimes(3);
  });
});

describe('mapWithConcurrency', () => {
  it('keeps input order and handles an empty list', async () => {
    expect(await mapWithConcurrency([3, 1, 2], 2, async (n) => n * 10)).toEqual([30, 10, 20]);
    expect(await mapWithConcurrency([], 4, async (n) => n)).toEqual([]);
  });
});

describe('subgraph extractor (spec 7.7 step 3)', () => {
  const dependents = Array.from({ length: 45 }, (_, i) => ({
    nodeId: `id-${i}`,
    path: `f${String(i).padStart(2, '0')}.ts`,
    contentHash: `h${i}`,
    sizeBytes: 1,
    distance: (i % 4) + 1,
  }));

  it('takes at most 40 dependents, nearest first', () => {
    const picked = nearestDependents(dependents);
    expect(picked).toHaveLength(MAX_SUBGRAPH_DEPENDENTS);
    expect(picked[0].distance).toBe(1);
    const distances = picked.map((d) => d.distance);
    expect([...distances].sort((a, b) => a - b)).toEqual(distances);
    expect(picked.some((d) => d.distance === 4)).toBe(true);
    expect(picked.filter((d) => d.distance === 4)).toHaveLength(40 - 12 - 11 - 11);
  });

  it('returns the target at distance 0 and asks only for edges among the selected nodes', async () => {
    const graphs = { edgesAmong: vi.fn(async () => [{ source: 'f00.ts', target: 't.ts' }]) };
    const target = { id: 'target-id', path: 't.ts', contentHash: 'ht' };
    const out = await createSubgraphExtractor(graphs).extract('u', 'r', target, dependents);
    expect(out.nodes[0]).toEqual({ path: 't.ts', contentHash: 'ht', distance: 0 });
    expect(out.nodes).toHaveLength(41);
    const ids = graphs.edgesAmong.mock.calls[0][2];
    expect(ids[0]).toBe('target-id');
    expect(ids).toHaveLength(41);
    expect(out.edges).toEqual([{ source: 'f00.ts', target: 't.ts' }]);
  });
});
