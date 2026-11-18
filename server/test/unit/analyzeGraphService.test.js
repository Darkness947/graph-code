import { describe, it, expect, vi } from 'vitest';
import { createAnalyzeGraphService } from '../../src/services/ai/analyzeGraphService.js';
import { computeInputHash } from '../../src/services/ai/inputHash.js';

const target = {
  id: 't-id',
  path: 'src/t.ts',
  nodeType: 'file',
  contentHash: 'ht',
  sizeBytes: 10,
  commitSha: 'c'.repeat(40),
};

function service(graphOverrides = {}) {
  const audit = { record: vi.fn(async () => {}) };
  const gemini = { generateJson: vi.fn() };
  const svc = createAnalyzeGraphService({
    repos: { get: vi.fn(async () => ({ status: 'ready', owner: 'o', name: 'n' })) },
    graphs: {
      findNode: vi.fn(async () => target),
      findDependents: vi.fn(async () => [
        { nodeId: 'd-id', path: 'src/d.ts', contentHash: 'hd', sizeBytes: 10, distance: 1 },
      ]),
      edgesAmong: vi.fn(async () => []),
      listFilePaths: vi.fn(async () => new Set(['src/t.ts', 'src/d.ts'])),
      ...graphOverrides,
    },
    cache: { find: vi.fn(async () => null), save: vi.fn(async () => 'r-id') },
    audit,
    retriever: { retrieve: vi.fn(async () => []) },
    gemini,
    getToken: vi.fn(async () => 'gho_x'),
  });
  return { svc, audit, gemini };
}

const input = {
  userId: 'u',
  repositoryId: 'r',
  mode: 'blast_radius',
  nodeId: 't-id',
  sessionId: 's',
};

describe('AnalyzeGraphService audit coverage (spec 7.7 step 10)', () => {
  it('audits a failure while building the subgraph, with the target-only hash', async () => {
    const { svc, audit, gemini } = service({
      edgesAmong: vi.fn(async () => {
        throw new Error('db down');
      }),
    });
    await expect(svc.analyzeGraph(input)).rejects.toThrow('db down');
    expect(gemini.generateJson).not.toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledTimes(1);
    expect(audit.record.mock.calls[0][0]).toMatchObject({
      outcome: 'network_error',
      attempts: 0,
      model: null,
      cacheHit: false,
      inputHash: computeInputHash({
        mode: 'blast_radius',
        target,
        nodes: [{ path: 'src/t.ts', contentHash: 'ht', distance: 0 }],
      }),
    });
  });

  it('does not leave an unhandled rejection when the file-path load fails early', async () => {
    const { svc, audit, gemini } = service({
      listFilePaths: vi.fn(async () => {
        throw new Error('paths failed');
      }),
    });
    gemini.generateJson.mockResolvedValue({
      text: '{"summary":"s","risks":[]}',
      model: 'm1',
      attempts: 1,
      latencyMs: 1,
    });
    await expect(svc.analyzeGraph(input)).rejects.toThrow('paths failed');
    expect(audit.record.mock.calls[0][0]).toMatchObject({
      outcome: 'network_error',
      model: 'm1',
      attempts: 1,
    });
  });
});
