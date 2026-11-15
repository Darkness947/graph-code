import { parseFile, resolveImports } from './graphBuilder.js';

/** Progress is written after this many files, or after PROGRESS_INTERVAL_MS (spec 7.5 step 3). */
export const PROGRESS_EVERY_FILES = 20;
export const PROGRESS_INTERVAL_MS = 1000;

/**
 * The parsing step (spec 7.5 step 3). Parses every extracted file, records a file that fails to
 * parse in `ctx.skipped` with reason `parse_error`, and writes `files_processed` and
 * `files_skipped` every 20 files or every second, whichever comes first, and once at the end.
 * `files_processed` counts every attempted file, so it ends equal to `files_total`.
 * Leaves `ctx.parsed` and drops `ctx.files`, so source text is not kept past parsing.
 * Stops early, leaving the job to the orchestrator, when the job is no longer running.
 * @param {{ registry: ReturnType<typeof import('./languages/languageRegistry.js').createLanguageRegistry>,
 *   parserService: { parse: Function }, now?: () => number }} deps
 * @returns {import('./orchestrator.js').PipelineStep}
 */
export function createParsingStep({ registry, parserService, now = Date.now }) {
  return async function parsing(ctx) {
    const files = ctx.files;
    ctx.files = undefined;
    /** @type {import('./graphBuilder.js').ParsedFile[]} */
    const parsed = [];
    let processed = 0;
    let reported = 0;
    let reportedAt = now();
    const report = async () => {
      reported = processed;
      reportedAt = now();
      return ctx.jobs.updateCounts(ctx.job.id, {
        filesProcessed: processed,
        filesSkipped: ctx.skipped.length,
      });
    };

    for (const file of files) {
      const result = parseFile(file, { registry, parserService });
      if (result && 'error' in result) ctx.skipped.push({ path: file.path, reason: result.error });
      else if (result) parsed.push(result);
      processed++;
      const due =
        processed - reported >= PROGRESS_EVERY_FILES || now() - reportedAt >= PROGRESS_INTERVAL_MS;
      if (due && !(await report())) return;
    }
    if (processed !== reported && !(await report())) return;
    ctx.parsed = parsed;
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
    ctx.fileGraph = {
      files: parsed.map((p) => p.file),
      ...resolveImports(parsed, ctx.configFiles, registry),
      skipped: ctx.skipped,
    };
  };
}
