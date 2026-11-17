import { describe, expect, it } from 'vitest';
import { centralityThresholds, centralityTier } from './centrality.js';

const files = (fanIns) => fanIns.map((fanIn) => ({ type: 'file', metrics: { fanIn } }));
const tiers = (fanIns) => {
  const t = centralityThresholds(files(fanIns));
  return fanIns.map((f) => centralityTier(f, t));
};

describe('centrality thresholds', () => {
  it('marks the top 10% and the top 3% of 100 files', () => {
    // fanIn 100, 99, …, 1
    const fanIns = Array.from({ length: 100 }, (_, i) => 100 - i);
    expect(centralityThresholds(files(fanIns))).toEqual({ top: 91, peak: 98 });
    const counts = tiers(fanIns).reduce((acc, t) => ({ ...acc, [t]: (acc[t] ?? 0) + 1 }), {});
    expect(counts).toEqual({ 0: 90, 1: 7, 2: 3 });
  });

  it('marks 7 and 2 files out of 70, the size of the test repository', () => {
    const fanIns = Array.from({ length: 70 }, (_, i) => 70 - i);
    const result = tiers(fanIns);
    expect(result.filter((t) => t >= 1)).toHaveLength(7);
    expect(result.filter((t) => t === 2)).toHaveLength(2);
  });

  it('includes every file tied with the cut-off', () => {
    const fanIns = [9, 5, 5, 5, ...Array(16).fill(1)];
    // 20 files: top rank 2 (fanIn 5), peak rank 1 (fanIn 9).
    expect(tiers(fanIns).slice(0, 5)).toEqual([2, 1, 1, 1, 0]);
  });

  it('never ranks a file that nothing imports', () => {
    expect(centralityThresholds(files([0, 0, 0]))).toEqual({ top: Infinity, peak: Infinity });
    expect(tiers([3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])).toEqual([2, ...Array(11).fill(0)]);
  });

  it('ranks at least one file in a small graph', () => {
    expect(tiers([4, 2, 1])).toEqual([2, 0, 0]);
  });

  it('ignores folders and copes with no files', () => {
    expect(centralityThresholds([{ type: 'folder', metrics: { fileCount: 3 } }])).toEqual({
      top: Infinity,
      peak: Infinity,
    });
  });
});
