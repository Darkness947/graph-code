import { IngestionError } from './IngestionError.js';
import { PHASES } from './jobRepository.js';

/**
 * @typedef {{ job: { id: string, repositoryId: string, jobType: string },
 *   jobs: ReturnType<typeof import('./jobRepository.js').createJobRepository>,
 *   [key: string]: unknown }} PipelineContext
 *   Shared by the steps of one run; each step reads what earlier steps left on it.
 * @typedef {(ctx: PipelineContext) => Promise<void>} PipelineStep
 * @typedef {Record<'fetching' | 'extracting' | 'parsing' | 'resolving' | 'persisting', PipelineStep>} PipelineSteps
 */

/** Failure code for an error that does not carry its own (spec 7.5 steps 1 and 5). */
const PHASE_FAILURE_CODE = Object.freeze({
  fetching: 'DOWNLOAD_FAILED',
  extracting: 'INTERNAL',
  parsing: 'INTERNAL',
  resolving: 'INTERNAL',
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
   * stops being running (for example after startup recovery). Every failure sets the job and
   * repository to `failed` with a spec 6.1 code.
   * @param {string} jobId
   * @returns {Promise<void>}
   */
  async run(jobId) {
    const job = await this.jobs.start(jobId);
    if (!job) return;
    /** @type {PipelineContext} */
    const ctx = { job, jobs: this.jobs };
    let phase = PHASES[0];
    try {
      for (phase of PHASES) {
        // start() already set the first phase.
        if (phase !== PHASES[0] && !(await this.jobs.setPhase(job.id, phase))) return;
        await this.steps[phase](ctx);
      }
    } catch (err) {
      const code = err instanceof IngestionError ? err.code : PHASE_FAILURE_CODE[phase];
      this.logger.error(`Ingestion job ${job.id} failed in ${phase} with ${code}: ${err?.message}`);
      await this.jobs.fail(job.id, code);
    }
  }
}
