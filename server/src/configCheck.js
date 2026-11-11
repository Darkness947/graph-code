import process from 'node:process';
import { describeConfig } from './config.js';

/**
 * `npm run config:check`: validates the environment and prints one line per variable.
 * Prints names and statuses only, never values.
 */
if (process.env.NODE_ENV !== 'production') {
  const { config: loadDotenv } = await import('dotenv');
  loadDotenv({ quiet: true });
}

const rows = describeConfig(process.env);
let failed = false;
for (const { name, status, note } of rows) {
  if (status === 'missing' || status === 'invalid') failed = true;
  console.log(`${status.padEnd(16)} ${name}${note ? `  (${note})` : ''}`);
}
console.log(failed ? '\nconfig:check FAILED' : '\nconfig:check passed');
process.exit(failed ? 1 : 0);
