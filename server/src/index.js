import process from 'node:process';
import { loadConfig, ConfigError } from './config.js';
import { createApp } from './app.js';
import { createPool } from './db/pool.js';
import { startIngestion } from './services/ingestion/startIngestion.js';

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
// Recovery (spec 7.5) finishes before the server accepts requests.
let queue;
try {
  queue = await startIngestion({ pool, concurrency: config.INGEST_CONCURRENCY });
} catch (err) {
  console.error(`Startup failed: could not recover ingestion jobs (${err.message})`);
  process.exit(1);
}

createApp(config, { pool, enqueue: queue.enqueue }).listen(config.PORT, () => {
  console.log(`Graph Code server listening on port ${config.PORT}`);
});
