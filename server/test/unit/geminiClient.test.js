import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ApiError } from '@google/genai';
import {
  createGeminiClient,
  classifyError,
  GENERATION_SETTINGS,
} from '../../src/services/ai/geminiClient.js';

const MODELS = ['m1', 'm2', 'm3'];
const TIMEOUT_MS = 20000;
const ATTEMPT_MS = 12000;
const INPUT = {
  systemInstruction: 'SYSTEM',
  prompt: 'PROMPT-SECRET-EXCERPT',
  responseSchema: { type: 'OBJECT' },
  requestId: 'req-1',
};

const apiError = (status) => new ApiError({ message: `status ${status}`, status });
const ok = (text = '{"summary":"s","risks":[]}') => ({
  text,
  candidates: [{ finishReason: 'STOP' }],
});

/**
 * A fake SDK whose behaviour per model is a queue of outcomes: a response object, an Error to
 * throw, or 'hang' (never settles).
 */
function fakeSdk(plan) {
  const calls = [];
  const queues = Object.fromEntries(Object.entries(plan).map(([m, list]) => [m, [...list]]));
  return {
    calls,
    models: {
      generateContent: vi.fn(async (params) => {
        calls.push(params);
        const next = queues[params.model]?.shift();
        if (next === 'hang') return new Promise(() => {});
        if (next instanceof Error) throw next;
        if (!next) throw new Error(`unexpected call to ${params.model}`);
        return next;
      }),
    },
  };
}

function client(sdk, extra = {}) {
  const log = vi.fn();
  return {
    log,
    router: createGeminiClient({
      models: MODELS,
      timeoutMs: TIMEOUT_MS,
      attemptTimeoutMs: ATTEMPT_MS,
      sdk,
      log,
      ...extra,
    }),
  };
}

async function failureOf(promise) {
  try {
    await promise;
  } catch (err) {
    return err;
  }
  throw new Error('expected a failure');
}

describe('Gemini model router (spec 7.7 step 8)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('sends the required settings, the schema and the system instruction on every call', async () => {
    const sdk = fakeSdk({ m1: [ok()] });
    await client(sdk).router.generateJson(INPUT);
    const { config, contents, model } = sdk.calls[0];
    expect(model).toBe('m1');
    expect(contents).toBe(INPUT.prompt);
    expect(config).toMatchObject({
      ...GENERATION_SETTINGS,
      responseSchema: INPUT.responseSchema,
      systemInstruction: 'SYSTEM',
    });
    expect(config.abortSignal).toBeInstanceOf(AbortSignal);
  });

  it('moves to the next model on 429', async () => {
    const sdk = fakeSdk({ m1: [apiError(429)], m2: [ok()] });
    const out = await client(sdk).router.generateJson(INPUT);
    expect(out).toMatchObject({ model: 'm2', attempts: 2 });
  });

  it('moves to the next model on 404', async () => {
    const sdk = fakeSdk({ m1: [apiError(404)], m2: [ok()] });
    const out = await client(sdk).router.generateJson(INPUT);
    expect(out).toMatchObject({ model: 'm2', attempts: 2 });
  });

  it('retries the same model once after 1 s on 503, then moves on', async () => {
    const sdk = fakeSdk({ m1: [apiError(503), apiError(503)], m2: [ok()] });
    const pending = client(sdk).router.generateJson(INPUT);
    await vi.advanceTimersByTimeAsync(999);
    expect(sdk.calls.map((c) => c.model)).toEqual(['m1']);
    await vi.advanceTimersByTimeAsync(1);
    const out = await pending;
    expect(sdk.calls.map((c) => c.model)).toEqual(['m1', 'm1', 'm2']);
    expect(out).toMatchObject({ model: 'm2', attempts: 3 });
  });

  it('succeeds on the retry of a 503', async () => {
    const sdk = fakeSdk({ m1: [apiError(503), ok()] });
    const pending = client(sdk).router.generateJson(INPUT);
    await vi.advanceTimersByTimeAsync(1000);
    expect(await pending).toMatchObject({ model: 'm1', attempts: 2 });
  });

  it('stops immediately on 401 and never calls the remaining models', async () => {
    const sdk = fakeSdk({ m1: [apiError(401)], m2: [ok()], m3: [ok()] });
    const err = await failureOf(client(sdk).router.generateJson(INPUT));
    expect(err.code).toBe('AI_UNREACHABLE');
    expect(err.outcome).toBe('network_error');
    expect(err.attempts).toBe(1);
    expect(sdk.calls.map((c) => c.model)).toEqual(['m1']);
  });

  it.each([400, 403])('treats %i as fatal', async (status) => {
    const sdk = fakeSdk({ m1: [apiError(status)], m2: [ok()] });
    const err = await failureOf(client(sdk).router.generateJson(INPUT));
    expect(err.code).toBe('AI_UNREACHABLE');
    expect(sdk.calls).toHaveLength(1);
  });

  it('moves to the next model on MAX_TOKENS and on empty text', async () => {
    const sdk = fakeSdk({
      m1: [{ text: '{"summ', candidates: [{ finishReason: 'MAX_TOKENS' }] }],
      m2: [{ text: '', candidates: [{ finishReason: 'STOP' }] }],
      m3: [ok()],
    });
    const out = await client(sdk).router.generateJson(INPUT);
    expect(out).toMatchObject({ model: 'm3', attempts: 3 });
  });

  it('gives AI_MALFORMED when the last failure was incomplete', async () => {
    const incomplete = { text: 'x', candidates: [{ finishReason: 'MAX_TOKENS' }] };
    const sdk = fakeSdk({ m1: [apiError(429)], m2: [apiError(404)], m3: [incomplete] });
    const err = await failureOf(client(sdk).router.generateJson(INPUT));
    expect(err).toMatchObject({ code: 'AI_MALFORMED', outcome: 'malformed_output', attempts: 3 });
  });

  it('gives AI_QUOTA_EXCEEDED when every model returns 429', async () => {
    const sdk = fakeSdk({ m1: [apiError(429)], m2: [apiError(429)], m3: [apiError(429)] });
    const err = await failureOf(client(sdk).router.generateJson(INPUT));
    expect(err).toMatchObject({
      code: 'AI_QUOTA_EXCEEDED',
      status: 429,
      outcome: 'quota_exceeded',
      attempts: 3,
    });
  });

  it('returns the name of the model that answered when the second succeeds', async () => {
    const sdk = fakeSdk({ m1: [apiError(429)], m2: [ok('{"summary":"two","risks":[]}')] });
    const out = await client(sdk).router.generateJson(INPUT);
    expect(out.model).toBe('m2');
    expect(out.text).toBe('{"summary":"two","risks":[]}');
    expect(typeof out.latencyMs).toBe('number');
  });

  it('respects the overall deadline: elapsed time never exceeds AI_TIMEOUT_MS', async () => {
    const sdk = fakeSdk({ m1: ['hang'], m2: ['hang'], m3: ['hang'] });
    const start = Date.now();
    let settledAt = null;
    const pending = client(sdk)
      .router.generateJson(INPUT)
      .catch((err) => {
        settledAt = Date.now();
        return err;
      });
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS + 5000);
    const err = await pending;
    expect(err).toMatchObject({ code: 'AI_TIMEOUT', outcome: 'timeout', status: 504 });
    expect(settledAt - start).toBeLessThanOrEqual(TIMEOUT_MS);
    // m1 gets 12 s, m2 the remaining 8 s; m3 is never started (less than 2 s left).
    expect(sdk.calls.map((c) => c.model)).toEqual(['m1', 'm2']);
    expect(err.attempts).toBe(2);
    expect(sdk.calls[0].config.abortSignal.aborted).toBe(true);
  });

  it('does not retry a 503 when the delay would leave less than 2 s', async () => {
    // m1 uses 17.5 s; m2 fails at once with 2.5 s left, too little for the 1 s retry delay.
    const sdk = fakeSdk({ m1: ['hang'], m2: [apiError(503)], m3: ['hang'] });
    const pending = client(sdk, { attemptTimeoutMs: 17500 }).router.generateJson(INPUT);
    const caught = pending.catch((e) => e);
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS);
    const err = await caught;
    expect(sdk.calls.map((c) => c.model)).toEqual(['m1', 'm2', 'm3']);
    expect(err.code).toBe('AI_TIMEOUT');
  });

  it('logs request id, model, classification and status, never the prompt', async () => {
    const sdk = fakeSdk({ m1: [apiError(429)], m2: [ok()] });
    const { router, log } = client(sdk);
    await router.generateJson(INPUT);
    const lines = log.mock.calls.map((c) => c[0]);
    expect(lines).toEqual([
      '[req-1] ai attempt model=m1 classification=quota status=429',
      '[req-1] ai attempt model=m2 classification=ok status=200',
    ]);
    expect(lines.join('\n')).not.toContain('PROMPT');
  });
});

describe('classifyError', () => {
  it.each([
    [429, 'quota'],
    [404, 'model_unavailable'],
    [500, 'unavailable'],
    [503, 'unavailable'],
    [504, 'unavailable'],
    [400, 'fatal'],
    [401, 'fatal'],
    [403, 'fatal'],
  ])('maps HTTP %i to %s', (status, classification) => {
    expect(classifyError(apiError(status)).classification).toBe(classification);
  });

  it('maps a network failure (no status) to unavailable and an abort to timeout', () => {
    expect(classifyError(new TypeError('fetch failed')).classification).toBe('unavailable');
    const abort = new Error('aborted');
    abort.name = 'AbortError';
    expect(classifyError(abort).classification).toBe('timeout');
  });

  it('ignores message text', () => {
    expect(classifyError(new Error('429 RESOURCE_EXHAUSTED quota')).classification).toBe(
      'unavailable',
    );
  });
});
