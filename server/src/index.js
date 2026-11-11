import process from 'node:process';
import { loadConfig, ConfigError } from './config.js';
import { createApp } from './app.js';

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

createApp(config).listen(config.PORT, () => {
  console.log(`Graph Code server listening on port ${config.PORT}`);
});
