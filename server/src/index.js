import process from 'node:process';
import { loadConfig, ConfigError } from './config.js';
import { createApp } from './app.js';
import { createPool } from './db/pool.js';
import { createJobRepository } from './services/ingestion/jobRepository.js';
import { IngestionOrchestrator } from './services/ingestion/orchestrator.js';
import { createQueue } from './services/ingestion/queue.js';

if (process.env.NODE_ENV !== 'production') {
  const { config: loadDotenv } = await import('dotenv');
  loadDotenv({ quiet: true });
}

let config;
try {
  config = loadConfig(process.env);
} catch (err) {
  if (err instanceof ConfigError) {
    console.error(err.message);
    process.exit(1);
  }
  throw err;
}

const pool = createPool(config.DATABASE_URL);
const jobs = createJobRepository(pool);

// Spec 7.5: no job survives a restart, so fail every queued or running one before serving.
const recovered = await jobs.recoverStale();
if (recovered > 0) console.log(`Marked ${recovered} interrupted ingestion job(s) as failed`);

const orchestrator = new IngestionOrchestrator({ jobs });
const queue = createQueue({
  concurrency: config.INGEST_CONCURRENCY,
  run: (jobId) => orchestrator.run(jobId),
});

createApp(config, { pool, jobs, enqueue: queue.enqueue }).listen(config.PORT, () => {
  console.log(`Graph Code server listening on port ${config.PORT}`);
});
