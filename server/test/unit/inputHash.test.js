import { describe, it, expect } from 'vitest';
import { computeInputHash, PROMPT_VERSION } from '../../src/services/ai/inputHash.js';
import { loadConfig } from '../../src/config.js';

const base = () => ({
  mode: 'blast_radius',
  target: { path: 'src/lib/utils.ts', contentHash: 'h-utils' },
  nodes: [
    { path: 'src/lib/utils.ts', contentHash: 'h-utils', distance: 0 },
    { path: 'src/app/page.tsx', contentHash: 'h-page', distance: 1 },
    { path: 'src/app/layout.tsx', contentHash: 'h-layout', distance: 2 },
  ],
});

describe('computeInputHash (spec 7.7 step 4)', () => {
  it('gives the same hash for the same input, whatever the node order', () => {
    const a = computeInputHash(base());
    const reordered = base();
    reordered.nodes.reverse();
    expect(computeInputHash(base())).toBe(a);
    expect(computeInputHash(reordered)).toBe(a);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it("changes when a dependent's content hash changes", () => {
    const changed = base();
    changed.nodes[1].contentHash = 'h-page-2';
    expect(computeInputHash(changed)).not.toBe(computeInputHash(base()));
  });

  it("changes when a dependent's distance changes or a dependent is added", () => {
    const moved = base();
    moved.nodes[2].distance = 1;
    const added = base();
    added.nodes.push({ path: 'src/x.ts', contentHash: 'h-x', distance: 3 });
    expect(computeInputHash(moved)).not.toBe(computeInputHash(base()));
    expect(computeInputHash(added)).not.toBe(computeInputHash(base()));
  });

  it('changes when the target content hash changes', () => {
    const changed = base();
    changed.target.contentHash = 'h-utils-2';
    expect(computeInputHash(changed)).not.toBe(computeInputHash(base()));
  });

  it('does not depend on GEMINI_MODELS (the model is never an input)', () => {
    const env = {
      APP_ORIGIN: 'http://localhost:5173',
      DATABASE_URL: 'postgresql://u@h/db',
      SESSION_SECRET: 'a'.repeat(64),
      TOKEN_ENCRYPTION_KEY: Buffer.alloc(32).toString('base64'),
      GITHUB_CLIENT_ID: 'id',
      GITHUB_CLIENT_SECRET: 'secret',
      GEMINI_API_KEY: 'k',
    };
    const one = loadConfig({ ...env, GEMINI_MODELS: 'gemini-2.5-flash' });
    const two = loadConfig({ ...env, GEMINI_MODELS: 'gemini-2.5-flash-lite,gemini-flash-latest' });
    const hashWith = (cfg) => computeInputHash({ ...base(), models: cfg.GEMINI_MODELS });
    expect(hashWith(one)).toBe(hashWith(two));
    expect(hashWith(one)).toBe(computeInputHash(base()));
  });

  it('uses the blast-radius-v1 prompt version', () => {
    expect(PROMPT_VERSION).toBe('blast-radius-v1');
  });
});
