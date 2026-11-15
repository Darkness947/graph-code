import { setImmediate as yieldToEventLoop } from 'node:timers/promises';
import { assembleFileGraph, parseFileInto } from './graphBuilder.js';

/** Progress is written after this many files, or after PROGRESS_INTERVAL_MS (spec 7.5 step 3). */
export const PROGRESS_EVERY_FILES = 20;
export const PROGRESS_INTERVAL_MS = 1000;

/**
 * The parsing step (spec 7.5 step 3). Parses every extracted file, records a file that fails to
 * parse in `ctx.skipped` with reason `parse_error`, and writes `files_processed` and
 * `files_skipped` every 20 files or every second, whichever comes first, and once at the end.
 * `files_processed` counts every attempted file, so it ends equal to `files_total`.
 * Takes `ctx.files` and releases each file's source text once it is parsed; leaves `ctx.parsed`.
 * Yields to the event loop after each file so other requests and jobs are not starved.
 * Returns early, without `ctx.parsed`, when the job is no longer running (see `PipelineStep`).
 * @param {{ registry: ReturnType<typeof import('./languages/languageRegistry.js').createLanguageRegistry>,
 *   parserService: { parse: Function }, now?: () => number }} deps
 * @returns {import('./orchestrator.js').PipelineStep}
 */
export function createParsingStep({ registry, parserService, now = Date.now }) {
  return async function parsing(ctx) {
    const files = ctx.files;
    ctx.files = undefined;
    /** @type {import('./graphBuilder.js').ParseResults} */
    const results = { parsed: [], skipped: ctx.skipped };
    let processed = 0;
    let last = { count: 0, at: now() };
    /** Writes the counters when due (or when forced); false when the job is no longer running. */
    const report = async (force) => {
      const due =
        processed - last.count >= PROGRESS_EVERY_FILES || now() - last.at >= PROGRESS_INTERVAL_MS;
      if (!(force || due) || processed === last.count) return true;
      last = { count: processed, at: now() };
      return ctx.jobs.updateCounts(ctx.job.id, {
        filesProcessed: processed,
        filesSkipped: ctx.skipped.length,
      });
    };

    for (let i = 0; i < files.length; i++) {
      parseFileInto(files[i], { registry, parserService }, results);
      files[i] = undefined;
      processed++;
      if (!(await report(false))) return;
      await yieldToEventLoop();
    }
    if (!(await report(true))) return;
    ctx.parsed = results.parsed;
  };
}

/**
 * The resolving step (spec 7.5 step 4). Resolves `ctx.parsed` against `ctx.configFiles` and
 * leaves `ctx.fileGraph` (files, edges, unresolved imports, skipped files) for persisting.
 * @param {{ registry: ReturnType<typeof import('./languages/languageRegistry.js').createLanguageRegistry> }} deps
 * @returns {import('./orchestrator.js').PipelineStep}
 */
export function createResolvingStep({ registry }) {
  return async function resolving(ctx) {
    const parsed = ctx.parsed;
    ctx.parsed = undefined;
    ctx.fileGraph = assembleFileGraph({ parsed, skipped: ctx.skipped }, ctx.configFiles, registry);
  };
}
