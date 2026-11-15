import { createFetchingStep } from './fetcher.js';
import { createParsingStep, createResolvingStep } from './graphSteps.js';
import { createJobRepository } from './jobRepository.js';
import { createDefaultRegistry } from './languages/languageRegistry.js';
import { IngestionOrchestrator } from './orchestrator.js';
import { createParserService } from './parsing/parserService.js';
import { createPersistingStep } from './persister.js';
import { createQueue } from './queue.js';
import { createExtractingStep } from './zipExtractor.js';

/**
 * The real pipeline: fetching, extracting, parsing, resolving and persisting. One language registry serves every step, so what extraction keeps is what
 * parsing can read.
 * @param {{ pool: import('pg').Pool,
 *   crypto: ReturnType<typeof import('../auth/tokenCrypto.js').createTokenCrypto>,
 *   github: ReturnType<typeof import('../github/githubClient.js').createGithubClient>,
 *   limits: import('./limits.js').IngestionLimits,
 *   registry?: ReturnType<typeof createDefaultRegistry>,
 *   parserService?: { parse: Function },
 *   persistHook?: Parameters<typeof createPersistingStep>[0]['beforeChunk'] }} deps  `persistHook` is a test hook
 * @returns {import('./orchestrator.js').PipelineSteps}
 */
export function createPipelineSteps({
  pool,
  crypto,
  github,
  limits,
  registry = createDefaultRegistry(),
  parserService = createParserService(),
  persistHook,
}) {
  return Object.freeze({
    fetching: createFetchingStep({ pool, crypto, github }),
    extracting: createExtractingStep({ limits, registry }),
    parsing: createParsingStep({ registry, parserService }),
    resolving: createResolvingStep({ registry }),
    persisting: createPersistingStep({ pool, beforeChunk: persistHook }),
  });
}

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
