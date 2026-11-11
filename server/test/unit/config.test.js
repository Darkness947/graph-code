import { describe, it, expect } from 'vitest';
import { randomBytes } from 'node:crypto';
import { loadConfig, describeConfig, ConfigError } from '../../src/config.js';

const validEnv = () => ({
  NODE_ENV: 'development',
  APP_ORIGIN: 'http://localhost:5173',
  DATABASE_URL: 'postgresql://user:dbpass@ep-abc.example.neon.tech/neondb?sslmode=require',
  SESSION_SECRET: randomBytes(32).toString('hex'),
  TOKEN_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
});

function problemsOf(env) {
  try {
    loadConfig(env);
  } catch (err) {
    expect(err).toBeInstanceOf(ConfigError);
    return err;
  }
  throw new Error('expected loadConfig to throw');
}

describe('loadConfig', () => {
  it('accepts a minimal valid environment and applies the spec defaults', () => {
    const cfg = loadConfig(validEnv());
    expect(cfg.PORT).toBe(3000);
    expect(cfg.TRUST_PROXY_HOPS).toBe(1);
    expect(cfg.TOKEN_KEY_ID).toBe(1);
    expect(cfg.PARSER_BACKEND).toBe('native');
    expect(cfg.AI_TIMEOUT_MS).toBe(20000);
    expect(cfg.AI_ATTEMPT_TIMEOUT_MS).toBe(12000);
    expect(cfg.MAX_SOURCE_FILES).toBe(1000);
    expect(cfg.GEMINI_MODELS).toEqual([
      'gemini-2.5-flash',
      'gemini-2.5-flash-lite',
      'gemini-flash-latest',
    ]);
    expect(Object.isFrozen(cfg)).toBe(true);
  });

  it('reads overrides, integers and the model list', () => {
    const cfg = loadConfig({
      ...validEnv(),
      PORT: '4000',
      TRUST_PROXY_HOPS: '0',
      PARSER_BACKEND: 'wasm',
      GEMINI_MODELS: ' a , b ',
      MAX_SOURCE_FILES: '500',
    });
    expect(cfg.PORT).toBe(4000);
    expect(cfg.TRUST_PROXY_HOPS).toBe(0);
    expect(cfg.PARSER_BACKEND).toBe('wasm');
    expect(cfg.GEMINI_MODELS).toEqual(['a', 'b']);
    expect(cfg.MAX_SOURCE_FILES).toBe(500);
  });

  it('reports every missing required variable at once, by name', () => {
    const err = problemsOf({});
    const names = err.problems.map((p) => p.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'APP_ORIGIN',
        'DATABASE_URL',
        'SESSION_SECRET',
        'TOKEN_ENCRYPTION_KEY',
      ]),
    );
  });

  it('does not require GitHub or Gemini credentials yet', () => {
    const cfg = loadConfig(validEnv());
    expect(cfg.GITHUB_CLIENT_ID).toBeUndefined();
    expect(cfg.GEMINI_API_KEY).toBeUndefined();
  });

  it('rejects a SESSION_SECRET shorter than 64 hex characters or not hex', () => {
    for (const bad of ['abc123', 'z'.repeat(64), randomBytes(16).toString('hex')]) {
      const err = problemsOf({ ...validEnv(), SESSION_SECRET: bad });
      expect(err.problems.map((p) => p.name)).toContain('SESSION_SECRET');
    }
  });

  it('rejects a TOKEN_ENCRYPTION_KEY that is not base64 for exactly 32 bytes', () => {
    for (const bad of [
      randomBytes(16).toString('base64'),
      randomBytes(33).toString('base64'),
      'not base64 !!',
      randomBytes(32).toString('hex'),
    ]) {
      const err = problemsOf({ ...validEnv(), TOKEN_ENCRYPTION_KEY: bad });
      expect(err.problems.map((p) => p.name)).toContain('TOKEN_ENCRYPTION_KEY');
    }
  });

  it('rejects invalid URLs, integers, backends and environments', () => {
    const err = problemsOf({
      ...validEnv(),
      APP_ORIGIN: 'not a url',
      DATABASE_URL: 'mysql://x/y',
      GITHUB_CALLBACK_URL: 'nope',
      PORT: 'abc',
      TRUST_PROXY_HOPS: '-1',
      PARSER_BACKEND: 'java',
      NODE_ENV: 'staging',
      GEMINI_MODELS: ' , ',
    });
    const names = err.problems.map((p) => p.name);
    for (const n of [
      'APP_ORIGIN',
      'DATABASE_URL',
      'GITHUB_CALLBACK_URL',
      'PORT',
      'TRUST_PROXY_HOPS',
      'PARSER_BACKEND',
      'NODE_ENV',
      'GEMINI_MODELS',
    ]) {
      expect(names).toContain(n);
    }
  });

  it('normalises APP_ORIGIN to a bare origin so CORS compares equal', () => {
    for (const v of ['https://x.app/', 'https://x.app/some/path', 'https://x.app']) {
      expect(loadConfig({ ...validEnv(), APP_ORIGIN: v }).APP_ORIGIN).toBe('https://x.app');
    }
  });

  it('rejects a PORT above 65535', () => {
    expect(problemsOf({ ...validEnv(), PORT: '70000' }).problems.map((p) => p.name)).toContain(
      'PORT',
    );
  });

  it('never includes a variable value in an error message', () => {
    const secrets = {
      DATABASE_URL: 'mysql://leaky-user:leaky-pass@host/db',
      SESSION_SECRET: 'leaky-session-value',
      TOKEN_ENCRYPTION_KEY: 'leaky-key-value',
      APP_ORIGIN: 'leaky origin value',
    };
    const err = problemsOf({ ...validEnv(), ...secrets });
    for (const value of Object.values(secrets)) {
      expect(err.message).not.toContain(value);
      expect(JSON.stringify(err.problems)).not.toContain(value);
    }
  });
});

describe('describeConfig', () => {
  it('marks later-required variables as not yet required and reports no values', () => {
    const env = validEnv();
    const rows = describeConfig(env);
    const byName = Object.fromEntries(rows.map((r) => [r.name, r]));
    expect(byName.SESSION_SECRET.status).toBe('ok');
    expect(byName.GITHUB_CLIENT_ID.status).toBe('not yet required');
    expect(byName.GEMINI_API_KEY.status).toBe('not yet required');
    const text = JSON.stringify(rows);
    expect(text).not.toContain(env.SESSION_SECRET);
    expect(text).not.toContain(env.TOKEN_ENCRYPTION_KEY);
    expect(text).not.toContain('dbpass');
  });

  it('marks missing and invalid variables', () => {
    const rows = describeConfig({ ...validEnv(), SESSION_SECRET: 'short', DATABASE_URL: '' });
    const byName = Object.fromEntries(rows.map((r) => [r.name, r]));
    expect(byName.SESSION_SECRET.status).toBe('invalid');
    expect(byName.DATABASE_URL.status).toBe('missing');
  });
});
