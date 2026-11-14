import { IngestionError } from './IngestionError.js';

/**
 * @typedef {{ job: { id: string, repositoryId: string, jobType: string },
 *   jobs: ReturnType<typeof import('./jobRepository.js').createJobRepository>,
 *   [key: string]: unknown }} PipelineContext
 *   Shared by the steps of one run; each step reads what earlier steps left on it.
 * @typedef {(ctx: PipelineContext) => Promise<void>} PipelineStep
 * @typedef {Record<'fetching' | 'extracting' | 'parsing' | 'resolving' | 'persisting', PipelineStep>} PipelineSteps
 */

/** Pipeline phases in order (spec 5.2 `ingestion_jobs.phase`, 7.5). */
export const PHASES = Object.freeze([
  'fetching',
  'extracting',
  'parsing',
  'resolving',
  'persisting',
]);

/** Failure code for an error that carries none (spec 7.5 steps 1 and 5); otherwise INTERNAL. */
const PHASE_FAILURE_CODE = Object.freeze({
  fetching: 'DOWNLOAD_FAILED',
  persisting: 'PERSIST_FAILED',
});

const notImplemented = (phase) => async () => {
  throw new IngestionError('INTERNAL', `The ${phase} step is not implemented yet`);
};

/**
 * Placeholder steps until T2.3 (fetching, extracting), T2.4 (parsing, resolving) and
 * T2.5 (persisting) replace them. They fail the job with INTERNAL rather than leave it queued.
 * @type {PipelineSteps}
 */
export const PLACEHOLDER_STEPS = Object.freeze(
  Object.fromEntries(PHASES.map((phase) => [phase, notImplemented(phase)])),
);

/**
 * Runs one ingestion job through the five phases in order (spec 7.5). The persisting step must
 * mark the job succeeded inside its transaction (`jobs.succeed(jobId, report, client)`).
 */
export class IngestionOrchestrator {
  /**
   * @param {{ jobs: PipelineContext['jobs'], steps?: PipelineSteps,
   *   logger?: Pick<Console, 'error'> }} deps
   */
  constructor({ jobs, steps = PLACEHOLDER_STEPS, logger = console }) {
    this.jobs = jobs;
    this.steps = steps;
    this.logger = logger;
  }

  /**
   * Claims the job and runs it. Returns quietly if the job is no longer queued, or stops when it
   * stops being running (for example after startup recovery). Every failure, including a database
   * error outside a step, sets the job and repository to `failed` with a spec 6.1 code (7.5 step 6).
   * Never rejects: if even recording the failure fails, it logs and startup recovery cleans up.
   * @param {string} jobId
   * @returns {Promise<void>}
   */
  async run(jobId) {
    /** The phase whose step is running; null before the first step starts. */
    let phase = null;
    try {
      const job = await this.jobs.start(jobId);
      if (!job) return;
      /** @type {PipelineContext} */
      const ctx = { job, jobs: this.jobs };
      for (const next of PHASES) {
        // Outside a step, a database error is INTERNAL, never the previous phase's code.
        phase = null;
        if (!(await this.jobs.setPhase(job.id, next))) return;
        phase = next;
        await this.steps[phase](ctx);
      }
      // A no-op once persisting has marked the job succeeded; otherwise it never would end.
      if (await this.jobs.fail(job.id, 'INTERNAL')) {
        this.logger.error(`Ingestion job ${job.id}: persisting finished without marking success`);
      }
    } catch (err) {
      const code =
        err instanceof IngestionError ? err.code : (PHASE_FAILURE_CODE[phase] ?? 'INTERNAL');
      this.logger.error(
        `Ingestion job ${jobId} failed in ${phase ?? 'setup'} with ${code}: ${err?.message}`,
      );
      try {
        await this.jobs.fail(jobId, code);
      } catch (failErr) {
        this.logger.error(`Ingestion job ${jobId}: could not record failure: ${failErr?.message}`);
      }
    }
  }
}
