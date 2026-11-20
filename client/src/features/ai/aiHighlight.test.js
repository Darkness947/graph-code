import { describe, expect, it } from 'vitest';
import { SAMPLE } from '../../../test/graphFixture.js';
import { buildGraphIndex } from '../graph/graphIndex.js';
import { aiHighlight, analysisInFlight, selectedAiResult } from './aiHighlight.js';

const index = buildGraphIndex(SAMPLE);

describe('aiHighlight (spec 8.6 item 9)', () => {
  it('maps each risk path to its file id and level, and names the folders to open', () => {
    const { levels, folders } = aiHighlight(index, {
      risks: [
        { path: 'src/lib/deep/math.ts', level: 'high' },
        { path: 'app/page.tsx', level: 'medium' },
        { path: 'index.ts', level: 'low' },
      ],
    });
    expect([...levels]).toEqual([
      ['f:src/lib/deep/math.ts', 'high'],
      ['f:app/page.tsx', 'medium'],
      ['f:index.ts', 'low'],
    ]);
    // A root-level file needs no folder; a nested one names its own folder (the store opens
    // the folders above it).
    expect(folders).toEqual(['src/lib/deep', 'app']);
  });

  it('ignores paths that are not files in this graph, and repeats', () => {
    const { levels, folders } = aiHighlight(index, {
      risks: [
        { path: 'nope.ts', level: 'high' },
        { path: 'src', level: 'high' },
        { path: 'app/page.tsx', level: 'low' },
        { path: 'app/page.tsx', level: 'high' },
      ],
    });
    expect([...levels]).toEqual([['f:app/page.tsx', 'low']]);
    expect(folders).toEqual(['app']);
  });

  it('is empty without risks', () => {
    expect(aiHighlight(index, { risks: [] }).levels.size).toBe(0);
    expect(aiHighlight(index, null).folders).toEqual([]);
  });

  it('reads the selected success and whether anything is in flight', () => {
    const state = {
      selectedNodeId: 'a',
      aiByNodeId: {
        a: { status: 'success', result: { risks: [] } },
        b: { status: 'error', result: null },
      },
    };
    expect(selectedAiResult(state)).toEqual({ risks: [] });
    expect(selectedAiResult({ ...state, selectedNodeId: 'b' })).toBeNull();
    expect(analysisInFlight(state)).toBe(false);
    expect(analysisInFlight({ aiByNodeId: { c: { status: 'loading' } } })).toBe(true);
  });
});
