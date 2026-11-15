import { describe, expect, it, vi } from 'vitest';
import {
  createParsingStep,
  createResolvingStep,
  PROGRESS_INTERVAL_MS,
} from '../../src/services/ingestion/graphSteps.js';
import { createDefaultRegistry } from '../../src/services/ingestion/languages/languageRegistry.js';
import { createParserService } from '../../src/services/ingestion/parsing/parserService.js';

const registry = createDefaultRegistry();
const parserService = createParserService({ backend: 'native' });

/** n small JS files, each importing the previous one. */
const files = (n) =>
  Array.from({ length: n }, (_, i) => ({
    path: `f${i}.js`,
    content: i === 0 ? 'export const a = 1;' : `import './f${i - 1}';`,
  }));

function context(fileList, { updateCounts = vi.fn().mockResolvedValue(true), skipped = [] } = {}) {
  return {
    job: { id: 'job-1', repositoryId: 'repo-1', jobType: 'initial' },
    jobs: { updateCounts },
    files: fileList,
    configFiles: [],
    skipped,
  };
}

const progress = (ctx) => ctx.jobs.updateCounts.mock.calls.map(([, counts]) => counts);

describe('parsing step: progress (AC4)', () => {
  it('writes files_processed every 20 files and once at the end', async () => {
    const ctx = context(files(45));
    await createParsingStep({ registry, parserService, now: () => 0 })(ctx);
    expect(ctx.jobs.updateCounts).toHaveBeenCalledWith('job-1', expect.anything());
    expect(progress(ctx)).toEqual([
      { filesProcessed: 20, filesSkipped: 0 },
      { filesProcessed: 40, filesSkipped: 0 },
      { filesProcessed: 45, filesSkipped: 0 },
    ]);
  });

  it('writes no extra update when the last batch ends on a multiple of 20', async () => {
    const ctx = context(files(40));
    await createParsingStep({ registry, parserService, now: () => 0 })(ctx);
    expect(progress(ctx).map((c) => c.filesProcessed)).toEqual([20, 40]);
  });

  it('writes after one second even before 20 files', async () => {
    let clock = 0;
    const slow = {
      parse: (grammar, text) => {
        clock += PROGRESS_INTERVAL_MS / 2;
        return parserService.parse(grammar, text);
      },
    };
    const ctx = context(files(5));
    await createParsingStep({ registry, parserService: slow, now: () => clock })(ctx);
    expect(progress(ctx).map((c) => c.filesProcessed)).toEqual([2, 4, 5]);
  });

  it('counts a parse failure in files_skipped on top of the extraction skips', async () => {
    const throwing = {
      parse: (grammar, text) => {
        if (text.includes('BOOM')) throw new Error('boom');
        return parserService.parse(grammar, text);
      },
    };
    const skipped = [{ path: 'big.js', reason: 'too_large' }];
    const ctx = context([...files(2), { path: 'bad.ts', content: 'BOOM' }], { skipped });
    await createParsingStep({ registry, parserService: throwing, now: () => 0 })(ctx);
    expect(progress(ctx)).toEqual([{ filesProcessed: 3, filesSkipped: 2 }]);
    expect(ctx.skipped).toEqual([
      { path: 'big.js', reason: 'too_large' },
      { path: 'bad.ts', reason: 'parse_error' },
    ]);
    expect(ctx.parsed.map((p) => p.file.path)).toEqual(['f0.js', 'f1.js']);
  });

  it('stops parsing when the job is no longer running', async () => {
    const parse = vi.fn((grammar, text) => parserService.parse(grammar, text));
    const ctx = context(files(45), { updateCounts: vi.fn().mockResolvedValue(false) });
    await createParsingStep({ registry, parserService: { parse }, now: () => 0 })(ctx);
    expect(parse).toHaveBeenCalledTimes(20);
    expect(ctx.parsed).toBeUndefined();
  });

  it('drops the source text from the context once parsed', async () => {
    const ctx = context(files(1));
    await createParsingStep({ registry, parserService, now: () => 0 })(ctx);
    expect(ctx.files).toBeUndefined();
    expect(ctx.parsed[0].file).toMatchObject({ path: 'f0.js', language: 'js', exports: ['a'] });
  });
});

describe('resolving step', () => {
  it('leaves the file graph with edges, unresolved imports and skips', async () => {
    const ctx = context([
      ...files(2),
      { path: 'g.ts', content: "import '@/x'; import './nope'; import 'react';" },
    ]);
    ctx.configFiles = [
      { path: 'tsconfig.json', content: '{"compilerOptions":{"paths":{"@/*":["src/*"]}}}' },
    ];
    ctx.skipped.push({ path: 'big.js', reason: 'too_large' });
    await createParsingStep({ registry, parserService, now: () => 0 })(ctx);
    await createResolvingStep({ registry })(ctx);
    expect(ctx.parsed).toBeUndefined();
    expect(ctx.fileGraph).toEqual({
      files: [
        expect.objectContaining({ path: 'f0.js' }),
        expect.objectContaining({ path: 'f1.js' }),
        expect.objectContaining({ path: 'g.ts' }),
      ],
      edges: [{ from: 'f1.js', to: 'f0.js' }],
      unresolved: [
        { sourcePath: 'g.ts', specifier: '@/x', reason: 'alias_not_found' },
        { sourcePath: 'g.ts', specifier: './nope', reason: 'file_not_found' },
      ],
      skipped: [{ path: 'big.js', reason: 'too_large' }],
    });
  });
});
