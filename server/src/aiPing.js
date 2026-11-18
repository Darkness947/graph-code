import process from 'node:process';
import { GoogleGenAI } from '@google/genai';
import { loadConfig } from './config.js';
import { attemptOnce, GENERATION_SETTINGS } from './services/ai/geminiClient.js';

/** A minimal request with no repository data. */
const PING_REQUEST = Object.freeze({
  contents: 'Reply with this JSON object and nothing else: {"ok": true}',
  config: GENERATION_SETTINGS,
});

/**
 * `npm run ai:ping` (spec 7.7): one tiny request to each model in `models`, bypassing the
 * router, printing `ok` or the classification with the latency. Never prints the key.
 * @param {{ models: string[], timeoutMs: number,
 *   sdk: { models: { generateContent: (params: object) => Promise<any> } },
 *   log?: (line: string) => void, now?: () => number }} options
 * @returns {Promise<{ model: string, result: string, latencyMs: number }[]>}
 */
export async function runAiPing({ models, timeoutMs, sdk, log = console.log, now = Date.now }) {
  const width = Math.max(...models.map((m) => m.length));
  const rows = [];
  for (const model of models) {
    const start = now();
    const outcome = await attemptOnce(sdk, model, PING_REQUEST, timeoutMs);
    const latencyMs = now() - start;
    const result = outcome.ok
      ? 'ok'
      : `${outcome.classification}${outcome.status ? ` (HTTP ${outcome.status})` : ''}`;
    log(`${model.padEnd(width)}  ${result.padEnd(28)} ${latencyMs} ms`);
    rows.push({ model, result, latencyMs });
  }
  return rows;
}

if (import.meta.main) {
  if (process.env.NODE_ENV !== 'production') {
    const { config: loadDotenv } = await import('dotenv');
    loadDotenv({ quiet: true });
  }
  try {
    const config = loadConfig(process.env);
    const rows = await runAiPing({
      models: config.GEMINI_MODELS,
      timeoutMs: config.AI_ATTEMPT_TIMEOUT_MS,
      sdk: new GoogleGenAI({ apiKey: config.GEMINI_API_KEY }),
    });
    const okCount = rows.filter((r) => r.result === 'ok').length;
    console.log(`\nai:ping: ${okCount} of ${rows.length} models responded`);
    process.exit(okCount > 0 ? 0 : 1);
  } catch (err) {
    // ConfigError messages name variables only; other errors print their type, not details.
    console.error(`ai:ping FAILED: ${err.name === 'ConfigError' ? err.message : err.name}`);
    process.exit(1);
  }
}
