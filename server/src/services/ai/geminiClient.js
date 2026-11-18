import { GoogleGenAI } from '@google/genai';
import { aiError } from './aiErrors.js';

/** Below this much time left, the router stops instead of starting another attempt (spec 7.7). */
export const MIN_REMAINING_MS = 2000;
/** Delay before the single retry of an `unavailable` model (spec 7.7). */
export const RETRY_DELAY_MS = 1000;
/** Generation settings on every call (spec 7.7 step 8). */
export const GENERATION_SETTINGS = Object.freeze({
  responseMimeType: 'application/json',
  temperature: 0.2,
  maxOutputTokens: 4096,
});

/**
 * @typedef {'quota' | 'model_unavailable' | 'unavailable' | 'timeout' | 'incomplete' | 'fatal'} Classification
 * @typedef {{ models: { generateContent: (params: object) => Promise<any> } }} GenAiSdk
 */

/** Marks an attempt that ran out of time. */
class AttemptTimeout extends Error {
  constructor() {
    super('attempt timed out');
    this.name = 'AttemptTimeout';
  }
}

/**
 * Classifies a failed attempt by HTTP status and error type, never by message text (spec 7.7).
 * @param {unknown} err
 * @returns {{ classification: Classification, status: number | null }}
 */
export function classifyError(err) {
  if (err instanceof AttemptTimeout || err?.name === 'AbortError') {
    return { classification: 'timeout', status: null };
  }
  const status = Number.isInteger(err?.status) ? err.status : null;
  if (status === null) return { classification: 'unavailable', status };
  if (status === 429) return { classification: 'quota', status };
  if (status === 404) return { classification: 'model_unavailable', status };
  if (status >= 500) return { classification: 'unavailable', status };
  return { classification: 'fatal', status };
}

/**
 * Runs one generateContent call capped at `timeoutMs`. Resolves the answer text, or rejects with
 * the SDK error, an `AttemptTimeout`, or an `incomplete` marker.
 * @param {GenAiSdk} sdk
 * @param {string} model
 * @param {{ contents: string, config: object }} request
 * @param {number} timeoutMs
 * @returns {Promise<{ ok: true, text: string } | { ok: false, classification: Classification, status: number | null }>}
 */
export async function attemptOnce(sdk, model, request, timeoutMs) {
  const controller = new AbortController();
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new AttemptTimeout());
    }, timeoutMs);
  });
  try {
    const response = await Promise.race([
      sdk.models.generateContent({
        model,
        contents: request.contents,
        config: { ...request.config, abortSignal: controller.signal },
      }),
      timeout,
    ]);
    const finishReason = response?.candidates?.[0]?.finishReason;
    const text = typeof response?.text === 'string' ? response.text : '';
    if (finishReason === 'MAX_TOKENS' || text.trim() === '') {
      return { ok: false, classification: 'incomplete', status: null };
    }
    return { ok: true, text };
  } catch (err) {
    return { ok: false, ...classifyError(err) };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The final error when no model succeeded (spec 7.7). Carries `attempts` for the audit row; it
 * is not sent to the client.
 * @param {Classification[]} failures
 * @param {boolean} deadlineReached
 * @param {number} attempts
 * @returns {import('../../errors/AppError.js').AppError}
 */
export function finalError(failures, deadlineReached, attempts) {
  const last = failures.at(-1);
  let code;
  if (failures.length > 0 && failures.every((c) => c === 'quota')) code = 'AI_QUOTA_EXCEEDED';
  else if (last === 'fatal') code = 'AI_UNREACHABLE';
  else if (deadlineReached || last === 'timeout') code = 'AI_TIMEOUT';
  else if (last === 'incomplete') code = 'AI_MALFORMED';
  else code = 'AI_UNREACHABLE';
  return aiError(code, attempts);
}

/**
 * The Gemini model router (spec 7.7 step 8). Tries `models` in order within one overall deadline.
 * @param {{ apiKey?: string, models: string[], timeoutMs: number, attemptTimeoutMs: number,
 *   sdk?: GenAiSdk, log?: (line: string) => void, now?: () => number,
 *   sleep?: (ms: number) => Promise<void> }} options
 */
export function createGeminiClient({
  apiKey,
  models,
  timeoutMs,
  attemptTimeoutMs,
  sdk,
  log = (line) => console.log(line),
  now = Date.now,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}) {
  // The SDK sends the key in a header; it never appears in a URL or a log line. It is built on
  // first use, so apps that tests build without a key never construct it (it warns when keyless).
  let client = sdk;

  /**
   * @param {{ systemInstruction: string, prompt: string, responseSchema: object, requestId?: string }} input
   * @returns {Promise<{ text: string, model: string, attempts: number, latencyMs: number }>}
   * @throws {AppError} AI_QUOTA_EXCEEDED, AI_TIMEOUT, AI_MALFORMED or AI_UNREACHABLE, with
   *   `attempts` set
   */
  async function generateJson({ systemInstruction, prompt, responseSchema, requestId = '-' }) {
    client ??= new GoogleGenAI({ apiKey });
    const start = now();
    const deadline = start + timeoutMs;
    const request = {
      contents: prompt,
      config: { ...GENERATION_SETTINGS, responseSchema, systemInstruction },
    };
    /** @type {Classification[]} */
    const failures = [];
    let attempts = 0;
    let deadlineReached = false;

    models: for (const model of models) {
      let retried = false;
      for (;;) {
        const remaining = deadline - now();
        if (remaining < MIN_REMAINING_MS) {
          deadlineReached = true;
          break models;
        }
        attempts += 1;
        const result = await attemptOnce(
          client,
          model,
          request,
          Math.min(attemptTimeoutMs, remaining),
        );
        if (result.ok) {
          log(`[${requestId}] ai attempt model=${model} classification=ok status=200`);
          return { text: result.text, model, attempts, latencyMs: now() - start };
        }
        log(
          `[${requestId}] ai attempt model=${model} classification=${result.classification}` +
            ` status=${result.status ?? 'none'}`,
        );
        failures.push(result.classification);
        if (result.classification === 'fatal') break models;
        const canRetry =
          result.classification === 'unavailable' &&
          !retried &&
          deadline - now() >= RETRY_DELAY_MS + MIN_REMAINING_MS;
        if (!canRetry) break;
        retried = true;
        await sleep(RETRY_DELAY_MS);
      }
    }
    throw finalError(failures, deadlineReached, attempts);
  }

  return { generateJson };
}
