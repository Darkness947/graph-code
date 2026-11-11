/**
 * Environment loading and validation (spec Part 4.2).
 * `loadConfig` is pure: it reads only the object it is given. `.env` is loaded by the caller
 * (index.js, configCheck.js), and only when NODE_ENV !== 'production'.
 * Messages name variables, never their values.
 */

const ENVIRONMENTS = ['development', 'test', 'production'];
const PARSER_BACKENDS = ['native', 'wasm'];

/**
 * Optional tuning variables and their defaults (spec 4.1).
 * @type {Record<string, number>}
 */
const INT_DEFAULTS = {
  AI_ATTEMPT_TIMEOUT_MS: 12000,
  INGEST_CONCURRENCY: 1,
  MAX_ZIP_BYTES: 52428800,
  MAX_ZIP_ENTRIES: 20000,
  MAX_FILE_BYTES: 1048576,
  MAX_TOTAL_SOURCE_BYTES: 52428800,
  MAX_COMPRESSION_RATIO: 100,
  MAX_SOURCE_FILES: 1000,
  AI_TIMEOUT_MS: 20000,
};

/**
 * Variables that become required in a later task, once the human has created the external
 * resource (S-03 in T1.4, S-04 in T3.5). Until then they are format-checked only if present.
 */
export const LATER_REQUIRED = Object.freeze({
  GITHUB_CLIENT_ID: 'T1.4',
  GITHUB_CLIENT_SECRET: 'T1.4',
  GEMINI_API_KEY: 'T3.5',
});

/** Thrown by loadConfig. `problems` lists `{ name, problem }`; there are no values in it. */
export class ConfigError extends Error {
  /** @param {{ name: string, problem: string }[]} problems */
  constructor(problems) {
    super(
      `Invalid configuration:\n${problems.map((p) => `  - ${p.name}: ${p.problem}`).join('\n')}`,
    );
    this.name = 'ConfigError';
    this.problems = problems;
  }
}

const isBlank = (v) => v === undefined || v === null || String(v).trim() === '';

function isUrl(value, protocols) {
  try {
    return protocols.includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

function isStrictBase64(value) {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return false;
  return Buffer.from(value, 'base64').toString('base64') === value;
}

/**
 * Validates every variable and returns a frozen config object.
 * @param {Record<string, string | undefined>} env
 * @returns {Readonly<Record<string, any>>}
 * @throws {ConfigError} naming every missing or invalid variable
 */
export function loadConfig(env = process.env) {
  /** @type {{ name: string, problem: string }[]} */
  const problems = [];
  const bad = (name, problem) => problems.push({ name, problem });
  const cfg = {};

  const required = (name, check) => {
    if (isBlank(env[name])) return bad(name, 'is required but not set');
    const problem = check ? check(String(env[name]).trim()) : null;
    if (problem) return bad(name, problem);
    cfg[name] = String(env[name]).trim();
  };
  const optional = (name, check) => {
    if (isBlank(env[name])) return;
    const problem = check(String(env[name]).trim());
    if (problem) return bad(name, problem);
    cfg[name] = String(env[name]).trim();
  };
  const int = (name, fallback, min) => {
    if (isBlank(env[name])) {
      cfg[name] = fallback;
      return;
    }
    const raw = String(env[name]).trim();
    if (!/^\d+$/.test(raw) || Number(raw) < min) {
      return bad(name, `must be an integer of at least ${min}`);
    }
    cfg[name] = Number(raw);
  };

  const httpUrl = (v) => (isUrl(v, ['http:', 'https:']) ? null : 'must be a valid http(s) URL');
  const dbUrl = (v) =>
    isUrl(v, ['postgres:', 'postgresql:']) ? null : 'must be a valid postgresql:// URL';

  // Environment and server
  if (isBlank(env.NODE_ENV)) cfg.NODE_ENV = 'development';
  else if (!ENVIRONMENTS.includes(env.NODE_ENV.trim())) {
    bad('NODE_ENV', `must be one of ${ENVIRONMENTS.join(', ')}`);
  } else cfg.NODE_ENV = env.NODE_ENV.trim();
  int('PORT', 3000, 1);
  required('APP_ORIGIN', httpUrl);
  int('TRUST_PROXY_HOPS', 1, 0);

  // Database
  required('DATABASE_URL', dbUrl);
  optional('TEST_DATABASE_URL', dbUrl);

  // Secrets
  required('SESSION_SECRET', (v) =>
    /^[0-9a-fA-F]{64,}$/.test(v) ? null : 'must be at least 64 hexadecimal characters',
  );
  required('TOKEN_ENCRYPTION_KEY', (v) =>
    isStrictBase64(v) && Buffer.from(v, 'base64').length === 32
      ? null
      : 'must be base64 that decodes to exactly 32 bytes',
  );
  int('TOKEN_KEY_ID', 1, 1);

  // GitHub OAuth (required from T1.4)
  optional('GITHUB_CLIENT_ID', () => null);
  optional('GITHUB_CLIENT_SECRET', () => null);
  if (isBlank(env.GITHUB_CALLBACK_URL)) {
    cfg.GITHUB_CALLBACK_URL = 'http://localhost:5173/api/auth/github/callback';
  } else {
    const problem = httpUrl(String(env.GITHUB_CALLBACK_URL).trim());
    if (problem) bad('GITHUB_CALLBACK_URL', problem);
    else cfg.GITHUB_CALLBACK_URL = String(env.GITHUB_CALLBACK_URL).trim();
  }

  // Gemini (key required from T3.5)
  optional('GEMINI_API_KEY', () => null);
  const modelsRaw = isBlank(env.GEMINI_MODELS)
    ? 'gemini-2.5-flash,gemini-2.5-flash-lite,gemini-flash-latest'
    : String(env.GEMINI_MODELS);
  const models = modelsRaw
    .split(',')
    .map((m) => m.trim())
    .filter(Boolean);
  if (models.length === 0) bad('GEMINI_MODELS', 'must list at least one model');
  else cfg.GEMINI_MODELS = models;

  // Parser
  const backend = isBlank(env.PARSER_BACKEND) ? 'native' : String(env.PARSER_BACKEND).trim();
  if (!PARSER_BACKENDS.includes(backend)) {
    bad('PARSER_BACKEND', `must be one of ${PARSER_BACKENDS.join(', ')}`);
  } else cfg.PARSER_BACKEND = backend;

  // Optional tuning
  for (const [name, fallback] of Object.entries(INT_DEFAULTS)) int(name, fallback, 1);

  if (problems.length > 0) throw new ConfigError(problems);
  return Object.freeze(cfg);
}

/**
 * Reports the state of every known variable without revealing any value.
 * @param {Record<string, string | undefined>} env
 * @returns {{ name: string, status: 'ok' | 'missing' | 'invalid' | 'not set' | 'not yet required', note?: string }[]}
 */
export function describeConfig(env = process.env) {
  const names = [
    'NODE_ENV',
    'PORT',
    'APP_ORIGIN',
    'TRUST_PROXY_HOPS',
    'DATABASE_URL',
    'TEST_DATABASE_URL',
    'SESSION_SECRET',
    'TOKEN_ENCRYPTION_KEY',
    'TOKEN_KEY_ID',
    'GITHUB_CLIENT_ID',
    'GITHUB_CLIENT_SECRET',
    'GITHUB_CALLBACK_URL',
    'GEMINI_API_KEY',
    'GEMINI_MODELS',
    'PARSER_BACKEND',
    ...Object.keys(INT_DEFAULTS),
  ];
  /** @type {Map<string, string>} */
  const problemByName = new Map();
  try {
    loadConfig(env);
  } catch (err) {
    if (!(err instanceof ConfigError)) throw err;
    for (const p of err.problems) problemByName.set(p.name, p.problem);
  }
  return names.map((name) => {
    const problem = problemByName.get(name);
    if (problem) {
      return { name, status: isBlank(env[name]) ? 'missing' : 'invalid', note: problem };
    }
    if (isBlank(env[name])) {
      if (LATER_REQUIRED[name]) {
        return { name, status: 'not yet required', note: `required from ${LATER_REQUIRED[name]}` };
      }
      return { name, status: 'not set', note: 'default or unused' };
    }
    return { name, status: 'ok' };
  });
}
