/**
 * In-process FIFO job queue (spec 7.5 Queue). At most `concurrency` runs at once. The job row
 * is the source of truth, so nothing is persisted here; a restart is handled by startup recovery.
 * @param {{ concurrency: number, run: (jobId: string) => Promise<void>,
 *   logger?: Pick<Console, 'error'> }} options
 * @returns {{ enqueue: (jobId: string) => void, idle: () => Promise<void>, size: () => number }}
 */
export function createQueue({ concurrency, run, logger = console }) {
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new Error('concurrency must be a positive integer');
  }
  /** @type {string[]} */
  const waiting = [];
  let active = 0;
  /** @type {(() => void)[]} */
  let idleWaiters = [];

  function settleIdle() {
    if (active > 0 || waiting.length > 0) return;
    const waiters = idleWaiters;
    idleWaiters = [];
    waiters.forEach((resolve) => resolve());
  }

  function pump() {
    while (active < concurrency && waiting.length > 0) {
      const jobId = waiting.shift();
      active += 1;
      Promise.resolve()
        .then(() => run(jobId))
        .catch((err) => {
          logger.error(`Ingestion job ${jobId} crashed: ${err?.message}`);
        })
        .finally(() => {
          active -= 1;
          pump();
          settleIdle();
        });
    }
  }

  return {
    /** Adds a job to the end of the queue and starts it when a slot is free. */
    enqueue(jobId) {
      waiting.push(jobId);
      pump();
    },
    /** Resolves when nothing is running or waiting (used by tests and shutdown). */
    idle() {
      return new Promise((resolve) => {
        idleWaiters.push(resolve);
        settleIdle();
      });
    },
    /** Jobs running plus waiting. */
    size: () => active + waiting.length,
  };
}
