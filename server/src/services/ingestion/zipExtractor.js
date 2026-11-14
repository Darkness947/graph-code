import yauzl from 'yauzl';
import { IngestionError } from './IngestionError.js';
import { createDefaultRegistry } from './languages/languageRegistry.js';

/** Directories skipped at any depth (spec 7.5 step 2); `__tests__` is the test-file rule. */
const SKIPPED_DIRECTORIES = new Set([
  'node_modules',
  'dist',
  'build',
  'out',
  '.next',
  'coverage',
  '.git',
  'vendor',
  '__tests__',
]);
/** `*.test.*` and `*.spec.*`. */
const TEST_FILE_RE = /.\.(?:test|spec)\../;

/**
 * @typedef {object} ExtractedArchive
 * @property {{ path: string, content: string }[]} files supported source files, repository-relative
 * @property {{ path: string, content: string }[]} configFiles root configuration files
 * @property {{ path: string, reason: 'too_large' }[]} skipped supported files that were not kept
 */

/**
 * Turns a ZIP entry name into a repository-relative path: normalizes separators, rejects absolute
 * paths and any `..` segment (ARCHIVE_INVALID), and strips GitHub's top-level `<repo>-<sha>/`
 * folder.
 * @param {string} entryName
 * @returns {string | null} null for a directory, or an entry outside the top-level folder
 */
export function repositoryPath(entryName) {
  const name = entryName.replaceAll('\\', '/');
  if (name.startsWith('/') || /^[A-Za-z]:/.test(name)) {
    throw new IngestionError('ARCHIVE_INVALID', 'an entry has an absolute path');
  }
  const segments = name.split('/').filter((s) => s !== '' && s !== '.');
  if (segments.includes('..')) {
    throw new IngestionError('ARCHIVE_INVALID', 'an entry path contains ".."');
  }
  if (name.endsWith('/') || segments.length < 2) return null;
  return segments.slice(1).join('/');
}

/**
 * Classifies a repository-relative path without looking at its content (spec 7.5 step 2).
 * @param {string} path
 * @param {ReturnType<typeof createDefaultRegistry>} registry
 * @returns {'source' | 'config' | 'skip'}
 */
export function classifyPath(path, registry) {
  const segments = path.split('/');
  const fileName = segments.pop();
  if (segments.length === 0 && registry.configFileNames().includes(fileName)) return 'config';
  if (segments.some((dir) => SKIPPED_DIRECTORIES.has(dir))) return 'skip';
  if (TEST_FILE_RE.test(fileName) || fileName.endsWith('.d.ts')) return 'skip';
  return registry.pluginForPath(path) ? 'source' : 'skip';
}

/**
 * Reads a repository archive in memory (spec 7.5 step 2): nothing is written to disk and nothing
 * is executed. Entries the skip rules drop are never inflated.
 * @param {Buffer} buffer the ZIP
 * @param {{ limits: import('./limits.js').IngestionLimits,
 *   registry?: ReturnType<typeof createDefaultRegistry> }} options
 * @returns {Promise<ExtractedArchive>}
 * @throws {IngestionError} ARCHIVE_INVALID, ARCHIVE_LIMIT_EXCEEDED, REPO_TOO_LARGE or
 *   NO_SUPPORTED_FILES
 */
export async function extractArchive(buffer, { limits, registry = createDefaultRegistry() }) {
  let zip;
  try {
    zip = await openZip(buffer);
    if (zip.entryCount > limits.maxZipEntries) {
      throw new IngestionError(
        'ARCHIVE_LIMIT_EXCEEDED',
        `the archive lists ${zip.entryCount} entries (limit ${limits.maxZipEntries})`,
      );
    }
    /** @type {ExtractedArchive} */
    const result = { files: [], configFiles: [], skipped: [] };
    let totalBytes = 0;

    for (let entry; (entry = await nextEntry(zip));) {
      // Also true for a non-empty entry that claims zero compressed bytes.
      if (entry.uncompressedSize > entry.compressedSize * limits.maxCompressionRatio) {
        throw new IngestionError(
          'ARCHIVE_LIMIT_EXCEEDED',
          `an entry's compression ratio is above ${limits.maxCompressionRatio}`,
        );
      }
      const path = repositoryPath(entry.fileName);
      if (path === null) continue;
      const kind = classifyPath(path, registry);
      if (kind === 'skip') continue;
      if (entry.uncompressedSize > limits.maxFileBytes) {
        if (kind === 'source') result.skipped.push({ path, reason: 'too_large' });
        continue;
      }
      if (kind === 'source' && result.files.length >= limits.maxSourceFiles) {
        throw new IngestionError(
          'REPO_TOO_LARGE',
          `the repository has more than ${limits.maxSourceFiles} source files`,
        );
      }
      const content = await inflate(zip, entry, limits.maxTotalSourceBytes - totalBytes);
      totalBytes += content.length;
      const file = { path, content: content.toString('utf8') };
      (kind === 'source' ? result.files : result.configFiles).push(file);
    }

    if (result.files.length === 0) throw new IngestionError('NO_SUPPORTED_FILES');
    return result;
  } catch (err) {
    // Anything the ZIP reader itself rejects (corrupt data, unsafe names, encryption) is invalid.
    if (err instanceof IngestionError) throw err;
    throw new IngestionError('ARCHIVE_INVALID', `the archive could not be read: ${err?.message}`);
  } finally {
    zip?.close();
  }
}

/** @returns {Promise<import('yauzl').ZipFile>} */
function openZip(buffer) {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(buffer, { lazyEntries: true }, (err, zip) =>
      err ? reject(err) : resolve(zip),
    );
  });
}

/** @returns {Promise<import('yauzl').Entry | null>} the next entry, or null at the end */
function nextEntry(zip) {
  return new Promise((resolve, reject) => {
    const settle = (fn) => (value) => {
      zip.off('entry', onEntry).off('end', onEnd).off('error', onError);
      fn(value);
    };
    const onEntry = settle(resolve);
    const onEnd = settle(() => resolve(null));
    const onError = settle(reject);
    zip.on('entry', onEntry).on('end', onEnd).on('error', onError);
    zip.readEntry();
  });
}

/**
 * Inflates one entry, counting the bytes that actually arrive rather than trusting the header.
 * @param {number} budget bytes of the total source limit still unused
 * @returns {Promise<Buffer>}
 */
function inflate(zip, entry, budget) {
  return new Promise((resolve, reject) => {
    zip.openReadStream(entry, (err, stream) => {
      if (err) return reject(err);
      const chunks = [];
      let size = 0;
      stream.on('data', (chunk) => {
        size += chunk.length;
        if (size > budget) {
          stream.destroy(
            new IngestionError('ARCHIVE_LIMIT_EXCEEDED', 'the total source size limit was passed'),
          );
          return;
        }
        chunks.push(chunk);
      });
      stream.on('error', reject);
      stream.on('end', () => resolve(Buffer.concat(chunks)));
    });
  });
}

/**
 * The extracting step (spec 7.5 step 2). Leaves `ctx.files`, `ctx.configFiles` and `ctx.skipped`,
 * sets `files_total`, and drops the archive so it can be garbage-collected.
 * @param {{ limits: import('./limits.js').IngestionLimits,
 *   registry?: ReturnType<typeof createDefaultRegistry> }} deps
 * @returns {import('./orchestrator.js').PipelineStep}
 */
export function createExtractingStep({ limits, registry }) {
  return async function extracting(ctx) {
    const archive = ctx.archive;
    ctx.archive = undefined;
    const { files, configFiles, skipped } = await extractArchive(archive, { limits, registry });
    Object.assign(ctx, { files, configFiles, skipped });
    await ctx.jobs.updateCounts(ctx.job.id, {
      filesTotal: files.length,
      filesSkipped: skipped.length,
    });
  };
}
