import { describe, it, expect, vi } from 'vitest';
import yauzl from 'yauzl';
import {
  classifyPath,
  createExtractingStep,
  extractArchive,
  repositoryPath,
} from '../../src/services/ingestion/zipExtractor.js';
import { limitsFromConfig } from '../../src/services/ingestion/limits.js';
import { createDefaultRegistry } from '../../src/services/ingestion/languages/languageRegistry.js';
import { ARCHIVE_ROOT, buildZip, renameEntry } from '../helpers/zip.js';

/** The spec 4.1 defaults. */
const DEFAULTS = limitsFromConfig({
  MAX_ZIP_BYTES: 52428800,
  MAX_ZIP_ENTRIES: 20000,
  MAX_FILE_BYTES: 1048576,
  MAX_TOTAL_SOURCE_BYTES: 52428800,
  MAX_COMPRESSION_RATIO: 100,
  MAX_SOURCE_FILES: 1000,
});
const limits = (over = {}) => ({ ...DEFAULTS, ...over });
const extract = (zip, over) => extractArchive(zip, { limits: limits(over) });
const paths = (list) => list.map((f) => f.path).sort();

describe('extractArchive: a normal archive', () => {
  it('returns supported files with the top-level folder stripped, and their content', async () => {
    const zip = await buildZip({
      'src/': '',
      'src/app.ts': "import './util';\n",
      'src/util.js': 'export const a = 1;\n',
      'README.md': '# hi',
    });
    const result = await extract(zip);
    expect(result.files).toEqual([
      { path: 'src/app.ts', content: "import './util';\n" },
      { path: 'src/util.js', content: 'export const a = 1;\n' },
    ]);
    expect(result.configFiles).toEqual([]);
    expect(result.skipped).toEqual([]);
  });

  it('keeps all six supported extensions', async () => {
    const names = ['a.js', 'b.jsx', 'c.mjs', 'd.cjs', 'e.ts', 'f.tsx'];
    const zip = await buildZip(Object.fromEntries(names.map((n) => [n, 'x'])));
    expect(paths((await extract(zip)).files)).toEqual(names);
  });
});

describe('extractArchive: limits (AC2)', () => {
  it('too many entries → ARCHIVE_LIMIT_EXCEEDED, before reading any entry', async () => {
    // Root folder + 3 files = 4 entries.
    const zip = await buildZip({ 'a.js': '1', 'b.js': '2', 'c.js': '3' });
    const real = yauzl.fromBuffer;
    let readEntry;
    const spy = vi.spyOn(yauzl, 'fromBuffer').mockImplementation((buf, opts, cb) =>
      real.call(yauzl, buf, opts, (err, zipfile) => {
        readEntry = vi.spyOn(zipfile, 'readEntry');
        cb(err, zipfile);
      }),
    );
    await expect(extract(zip, { maxZipEntries: 3 })).rejects.toMatchObject({
      code: 'ARCHIVE_LIMIT_EXCEEDED',
    });
    spy.mockRestore();
    expect(readEntry).not.toHaveBeenCalled();
  });

  it('exactly MAX_ZIP_ENTRIES entries is allowed', async () => {
    const zip = await buildZip({ 'a.js': '1', 'b.js': '2', 'c.js': '3' });
    expect((await extract(zip, { maxZipEntries: 4 })).files).toHaveLength(3);
  });

  it('ratio bomb → ARCHIVE_LIMIT_EXCEEDED, with the default ratio of 100', async () => {
    const zip = await buildZip({ 'bomb.js': Buffer.alloc(500_000, 0x20) });
    await expect(extract(zip)).rejects.toMatchObject({ code: 'ARCHIVE_LIMIT_EXCEEDED' });
  });

  it('a ratio bomb in an entry the skip rules would drop still aborts', async () => {
    const zip = await buildZip({ 'a.js': 'x', 'assets/big.bin': Buffer.alloc(500_000) });
    await expect(extract(zip)).rejects.toMatchObject({ code: 'ARCHIVE_LIMIT_EXCEEDED' });
  });

  it('a ratio equal to the limit is allowed; empty files are allowed', async () => {
    const zip = await buildZip(
      { 'a.js': 'stored, so ratio 1', 'empty.js': '' },
      { compress: false },
    );
    expect(paths((await extract(zip, { maxCompressionRatio: 1 })).files)).toEqual([
      'a.js',
      'empty.js',
    ]);
  });

  it('oversized file → skipped with reason too_large, not inflated, job continues', async () => {
    const zip = await buildZip(
      { 'big.js': 'x'.repeat(11), 'edge.js': 'x'.repeat(10), 'ok.ts': 'y' },
      { compress: false },
    );
    const result = await extract(zip, { maxFileBytes: 10 });
    expect(paths(result.files)).toEqual(['edge.js', 'ok.ts']);
    expect(result.skipped).toEqual([{ path: 'big.js', reason: 'too_large' }]);
  });

  it('a too_large file does not count toward the file limit', async () => {
    const zip = await buildZip({ 'big.js': 'x'.repeat(11), 'ok.ts': 'y' }, { compress: false });
    const result = await extract(zip, { maxFileBytes: 10, maxSourceFiles: 1 });
    expect(paths(result.files)).toEqual(['ok.ts']);
  });

  it('only too_large files → NO_SUPPORTED_FILES', async () => {
    const zip = await buildZip({ 'big.js': 'x'.repeat(11) }, { compress: false });
    await expect(extract(zip, { maxFileBytes: 10 })).rejects.toMatchObject({
      code: 'NO_SUPPORTED_FILES',
    });
  });

  it('`..` path → ARCHIVE_INVALID', async () => {
    const zip = renameEntry(
      await buildZip({ 'xx/evil.js': 'x', 'a.js': 'y' }),
      `${ARCHIVE_ROOT}/xx/evil.js`,
      `${ARCHIVE_ROOT}/../evil.js`,
    );
    await expect(extract(zip)).rejects.toMatchObject({ code: 'ARCHIVE_INVALID' });
  });

  it('absolute path → ARCHIVE_INVALID', async () => {
    const zip = renameEntry(
      await buildZip({ 'a.js': 'y', 'xetc/evil.js': 'x' }, { root: null }),
      'xetc/evil.js',
      '/etc/evil.js',
    );
    await expect(extract(zip)).rejects.toMatchObject({ code: 'ARCHIVE_INVALID' });
  });

  it('no supported files → NO_SUPPORTED_FILES', async () => {
    const zip = await buildZip({
      'README.md': '# hi',
      'main.py': 'print(1)',
      'tsconfig.json': '{}',
    });
    await expect(extract(zip)).rejects.toMatchObject({ code: 'NO_SUPPORTED_FILES' });
  });

  it('an archive with no entries → NO_SUPPORTED_FILES', async () => {
    await expect(extract(await buildZip({}, { root: null }))).rejects.toMatchObject({
      code: 'NO_SUPPORTED_FILES',
    });
  });

  it('more than 1,000 files → REPO_TOO_LARGE, with the default limit', async () => {
    const files = Object.fromEntries(
      Array.from({ length: 1001 }, (_, i) => [`src/f${i}.js`, `export default ${i};`]),
    );
    await expect(extract(await buildZip(files))).rejects.toMatchObject({ code: 'REPO_TOO_LARGE' });
  });

  it('exactly 1,000 files is allowed; skipped files do not count', async () => {
    const files = Object.fromEntries(
      Array.from({ length: 1000 }, (_, i) => [`src/f${i}.js`, `export default ${i};`]),
    );
    files['src/f0.test.js'] = 'x';
    files['node_modules/p/index.js'] = 'x';
    expect((await extract(await buildZip(files))).files).toHaveLength(1000);
  });

  it('total source over MAX_TOTAL_SOURCE_BYTES → ARCHIVE_LIMIT_EXCEEDED', async () => {
    const files = { 'a.js': 'x'.repeat(40), 'b.js': 'x'.repeat(40), 'c.js': 'x'.repeat(21) };
    const zip = await buildZip(files, { compress: false });
    await expect(extract(zip, { maxTotalSourceBytes: 100 })).rejects.toMatchObject({
      code: 'ARCHIVE_LIMIT_EXCEEDED',
    });
    expect((await extract(zip, { maxTotalSourceBytes: 101 })).files).toHaveLength(3);
  });

  it('data that is not a ZIP → ARCHIVE_INVALID', async () => {
    await expect(extract(Buffer.from('not a zip at all'))).rejects.toMatchObject({
      code: 'ARCHIVE_INVALID',
    });
  });

  it('a truncated ZIP → ARCHIVE_INVALID', async () => {
    const zip = await buildZip({ 'a.js': 'x'.repeat(500) });
    await expect(extract(zip.subarray(0, zip.length - 30))).rejects.toMatchObject({
      code: 'ARCHIVE_INVALID',
    });
  });

  it('corrupted file data → ARCHIVE_INVALID', async () => {
    const zip = await buildZip({ 'a.js': 'export const value = 12345;\n'.repeat(40) });
    // The first entry is the root folder; this lands inside the deflated data of a.js.
    const at = zip.indexOf(Buffer.from(`${ARCHIVE_ROOT}/a.js`)) + ARCHIVE_ROOT.length + 5;
    zip.fill(0xff, at, at + 12);
    await expect(extract(zip)).rejects.toMatchObject({ code: 'ARCHIVE_INVALID' });
  });
});

describe('extractArchive: skip rules (AC3)', () => {
  it.each([
    ['node_modules/pkg/index.js'],
    ['packages/a/node_modules/pkg/index.js'],
    ['dist/bundle.js'],
    ['packages/a/dist/bundle.js'],
    ['build/main.js'],
    ['out/main.js'],
    ['.next/server/page.js'],
    ['coverage/lcov-report/sorter.js'],
    ['.git/hooks/pre-commit.js'],
    ['vendor/lib.js'],
    ['src/vendor/lib.js'],
    ['src/app.test.js'],
    ['src/app.spec.tsx'],
    ['src/app.test.utils.ts'],
    ['src/__tests__/helper.ts'],
    ['__tests__/deep/helper.js'],
    ['src/types.d.ts'],
    ['README.md'],
    ['src/styles.css'],
    ['src/data.json'],
    ['src/tsconfig.json'],
    ['src/noextension'],
    ['src/.js'],
  ])('skips %s', async (path) => {
    const zip = await buildZip({ 'keep.js': 'x', [path]: 'y' });
    const result = await extract(zip);
    expect(paths(result.files)).toEqual(['keep.js']);
    expect(result.configFiles).toEqual([]);
    expect(result.skipped).toEqual([]);
  });

  it.each([
    ['src/build.js'],
    ['src/distance/index.ts'],
    ['src/vendors/lib.js'],
    ['src/test.js'],
    ['src/spec.ts'],
    ['src/latest.js'],
    ['src/contest.config.js'],
    ['src/my.d.tsx'],
    ['src/Upper.JS'],
  ])('keeps %s (looks like a skip rule but is not one)', async (path) => {
    const zip = await buildZip({ [path]: 'y' });
    expect(paths((await extract(zip)).files)).toEqual([path]);
  });

  it('keeps the root tsconfig.json and jsconfig.json as configuration, not as source', async () => {
    const zip = await buildZip({
      'tsconfig.json': '{ /* c */ "compilerOptions": {} }',
      'jsconfig.json': '{}',
      'packages/a/tsconfig.json': '{}',
      'a.ts': 'x',
    });
    const result = await extract(zip);
    expect(result.configFiles).toEqual([
      { path: 'tsconfig.json', content: '{ /* c */ "compilerOptions": {} }' },
      { path: 'jsconfig.json', content: '{}' },
    ]);
    expect(paths(result.files)).toEqual(['a.ts']);
  });

  it('never inflates a skipped entry', async () => {
    const zip = await buildZip({
      'keep.js': 'x',
      'node_modules/p/i.js': 'y',
      'a.test.js': 'y',
      'logo.png': 'y',
      'big.ts': 'z'.repeat(50),
    });
    const real = yauzl.fromBuffer;
    const inflated = [];
    const spy = vi.spyOn(yauzl, 'fromBuffer').mockImplementation((buf, opts, cb) =>
      real.call(yauzl, buf, opts, (err, zipfile) => {
        const open = zipfile.openReadStream.bind(zipfile);
        zipfile.openReadStream = (entry, done) => (
          inflated.push(entry.fileName),
          open(entry, done)
        );
        cb(err, zipfile);
      }),
    );
    await extract(zip, { maxFileBytes: 10, maxCompressionRatio: 1000 });
    spy.mockRestore();
    expect(inflated).toEqual([`${ARCHIVE_ROOT}/keep.js`]);
  });

  it('opens the archive with lazyEntries', async () => {
    const spy = vi.spyOn(yauzl, 'fromBuffer');
    await extract(await buildZip({ 'a.js': 'x' }));
    expect(spy.mock.calls[0][1]).toMatchObject({ lazyEntries: true });
    spy.mockRestore();
  });
});

describe('repositoryPath', () => {
  it.each([
    ['repo-sha/src/a.js', 'src/a.js'],
    ['repo-sha/a.js', 'a.js'],
    ['repo-sha\\src\\a.js', 'src/a.js'],
    ['repo-sha/./src//a.js', 'src/a.js'],
    ['repo-sha/src/..a.js', 'src/..a.js'],
  ])('%s → %s', (name, expected) => expect(repositoryPath(name)).toBe(expected));

  it.each([['repo-sha/'], ['repo-sha/src/'], ['top-level.js']])('%s → null', (name) =>
    expect(repositoryPath(name)).toBeNull(),
  );

  it.each([
    ['repo-sha/../a.js'],
    ['../a.js'],
    ['repo-sha/src/../../a.js'],
    ['repo-sha\\..\\a.js'],
    ['repo-sha/src/..'],
    ['/etc/passwd.js'],
    ['\\\\server\\share\\a.js'],
    ['C:/Windows/a.js'],
    ['c:\\a.js'],
  ])('%s → ARCHIVE_INVALID', (name) =>
    expect(() => repositoryPath(name)).toThrow(
      expect.objectContaining({ code: 'ARCHIVE_INVALID' }),
    ),
  );
});

describe('classifyPath', () => {
  const registry = createDefaultRegistry();
  it('derives supported extensions and configuration files from the registry', () => {
    expect(classifyPath('src/a.tsx', registry)).toBe('source');
    expect(classifyPath('jsconfig.json', registry)).toBe('config');
    expect(classifyPath('main.py', registry)).toBe('skip');
  });
});

describe('extracting step', () => {
  it('leaves the files on the context, sets the counters and drops the archive', async () => {
    const archive = await buildZip(
      { 'a.js': 'x', 'b.ts': 'y', 'big.js': 'z'.repeat(20), 'tsconfig.json': '{}' },
      { compress: false },
    );
    const jobs = { updateCounts: vi.fn().mockResolvedValue(true) };
    const ctx = { job: { id: 'job-1' }, jobs, archive, commitSha: 'a'.repeat(40) };
    await createExtractingStep({ limits: limits({ maxFileBytes: 10 }) })(ctx);
    expect(paths(ctx.files)).toEqual(['a.js', 'b.ts']);
    expect(paths(ctx.configFiles)).toEqual(['tsconfig.json']);
    expect(ctx.skipped).toEqual([{ path: 'big.js', reason: 'too_large' }]);
    expect(ctx.archive).toBeUndefined();
    expect(ctx.commitSha).toBe('a'.repeat(40));
    expect(jobs.updateCounts).toHaveBeenCalledExactlyOnceWith('job-1', {
      filesTotal: 2,
      filesSkipped: 1,
    });
  });

  it('a failed extraction also drops the archive and sets no counters', async () => {
    const jobs = { updateCounts: vi.fn() };
    const ctx = { job: { id: 'job-1' }, jobs, archive: Buffer.from('junk') };
    await expect(createExtractingStep({ limits: limits() })(ctx)).rejects.toMatchObject({
      code: 'ARCHIVE_INVALID',
    });
    expect(ctx.archive).toBeUndefined();
    expect(jobs.updateCounts).not.toHaveBeenCalled();
  });
});
