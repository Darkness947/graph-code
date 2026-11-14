import { createJobRepository } from './jobRepository.js';
import { IngestionOrchestrator } from './orchestrator.js';
import { createQueue } from './queue.js';

/**
 * Startup half of spec 7.5 Queue. First fails every queued or running job left over from before
 * the restart (INTERRUPTED), then returns the queue that runs new jobs. `index.js` awaits this
 * before it starts listening, so no new job can be enqueued until recovery has finished.
 * @param {{ pool: import('pg').Pool, concurrency: number,
 *   steps?: import('./orchestrator.js').PipelineSteps, logger?: Pick<Console, 'log' | 'error'> }} options
 * @returns {Promise<{ enqueue: (jobId: string) => void, idle: () => Promise<void>, recovered: number }>}
 */
export async function startIngestion({ pool, concurrency, steps, logger = console }) {
  const jobs = createJobRepository(pool);
  const recovered = await jobs.recoverStale();
  if (recovered > 0) logger.log(`Marked ${recovered} interrupted ingestion job(s) as failed`);
  const orchestrator = new IngestionOrchestrator({ jobs, steps, logger });
  const queue = createQueue({ concurrency, run: (jobId) => orchestrator.run(jobId), logger });
  return { ...queue, recovered };
}
