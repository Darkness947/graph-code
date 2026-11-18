import { describe, it, expect } from 'vitest';
import { validateResponse, MAX_REASON_CHARS } from '../../src/services/ai/responseValidator.js';

const ctx = {
  targetPath: 'src/lib/utils.ts',
  filePaths: new Set(['src/lib/utils.ts', 'src/app/page.tsx', 'src/app/layout.tsx', 'src/a.ts']),
  distances: new Map([
    ['src/app/page.tsx', 1],
    ['src/app/layout.tsx', 2],
    ['src/a.ts', 1],
  ]),
};
const answer = (risks, summary = 'Summary.') => JSON.stringify({ summary, risks });
const codeOf = (fn) => {
  try {
    fn();
  } catch (err) {
    return err.code;
  }
  return null;
};

describe('validateResponse (spec 7.7 step 9)', () => {
  it('removes risks whose path is not a file of the graph and counts them', () => {
    const out = validateResponse(
      answer([
        { path: 'src/app/page.tsx', level: 'high', reason: 'Calls format().' },
        { path: 'src/invented.ts', level: 'high', reason: 'Made up.' },
        { path: 'src/app', level: 'low', reason: 'A folder.' },
      ]),
      ctx,
    );
    expect(out.risks.map((r) => r.path)).toEqual(['src/app/page.tsx']);
    expect(out.removedCount).toBe(2);
  });

  it('removes the target itself', () => {
    const out = validateResponse(
      answer([
        { path: 'src/lib/utils.ts', level: 'high', reason: 'Self.' },
        { path: 'src/a.ts', level: 'low', reason: 'Imports it.' },
      ]),
      ctx,
    );
    expect(out.risks.map((r) => r.path)).toEqual(['src/a.ts']);
    expect(out.removedCount).toBe(1);
  });

  it('rejects malformed JSON, a missing risks array and a non-object as AI_MALFORMED', () => {
    expect(codeOf(() => validateResponse('{"summary": "x", "risks": [', ctx))).toBe('AI_MALFORMED');
    expect(codeOf(() => validateResponse('{"summary": "x"}', ctx))).toBe('AI_MALFORMED');
    expect(codeOf(() => validateResponse('null', ctx))).toBe('AI_MALFORMED');
    expect(codeOf(() => validateResponse('"text"', ctx))).toBe('AI_MALFORMED');
  });

  it('accepts an explicit empty list', () => {
    const out = validateResponse(answer([], 'Nothing at risk.'), ctx);
    expect(out).toEqual({ summary: 'Nothing at risk.', risks: [], removedCount: 0 });
  });

  it('rejects a list whose every risk was removed as AI_MALFORMED', () => {
    expect(
      codeOf(() =>
        validateResponse(answer([{ path: 'nope.ts', level: 'high', reason: 'x' }]), ctx),
      ),
    ).toBe('AI_MALFORMED');
  });

  it('normalizes level, drops unknown levels, trims reasons and strips control characters', () => {
    const out = validateResponse(
      answer([
        { path: 'src/app/page.tsx', level: ' HIGH ', reason: `a\u0000b\nc${'x'.repeat(500)}` },
        { path: 'src/a.ts', level: 'critical', reason: 'Unknown level.' },
      ]),
      ctx,
    );
    expect(out.risks).toHaveLength(1);
    expect(out.risks[0].level).toBe('high');
    expect(out.risks[0].reason).toHaveLength(MAX_REASON_CHARS);
    expect(out.risks[0].reason.startsWith('a b c')).toBe(true);
    expect(out.removedCount).toBe(1);
  });

  it('sorts by level, then by distance', () => {
    const out = validateResponse(
      answer([
        { path: 'src/app/layout.tsx', level: 'high', reason: 'r' },
        { path: 'src/a.ts', level: 'low', reason: 'r' },
        { path: 'src/app/page.tsx', level: 'high', reason: 'r' },
      ]),
      ctx,
    );
    expect(out.risks.map((r) => `${r.level}:${r.path}`)).toEqual([
      'high:src/app/page.tsx',
      'high:src/app/layout.tsx',
      'low:src/a.ts',
    ]);
  });
});
