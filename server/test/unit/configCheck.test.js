import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';

const script = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../src/configCheck.js');
const CONFIG_VARS = [
  'NODE_ENV',
  'PORT',
  'APP_ORIGIN',
  'TRUST_PROXY_HOPS',
  'DATABASE_URL',
  'TEST_DATABASE_URL',
  'SESSION_SECRET',
  'TOKEN_ENCRYPTION_KEY',
  'TOKEN_KEY_ID',
];

let dir;
const goodSecret = randomBytes(32).toString('hex');
const goodKey = randomBytes(32).toString('base64');

/** Runs config:check in a temp directory (so dotenv reads only the temp .env). */
function run(env) {
  const base = { ...process.env };
  for (const name of CONFIG_VARS) delete base[name];
  return spawnSync(process.execPath, [script], {
    cwd: dir,
    env: { ...base, ...env },
    encoding: 'utf8',
  });
}

beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'gc-config-'));
  writeFileSync(
    path.join(dir, '.env'),
    [
      'APP_ORIGIN=http://localhost:5173',
      'DATABASE_URL=postgresql://u:fixturepw@ep-x.example.neon.tech/neondb',
      `SESSION_SECRET=${goodSecret}`,
      `TOKEN_ENCRYPTION_KEY=${goodKey}`,
    ].join('\n'),
  );
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('config:check', () => {
  it('passes with exit 0 when .env is complete, and prints no values', () => {
    const res = run({ NODE_ENV: 'development' });
    expect(res.status).toBe(0);
    expect(res.stdout).toContain('config:check passed');
    for (const secret of [goodSecret, goodKey, 'fixturepw']) {
      expect(res.stdout + res.stderr).not.toContain(secret);
    }
  });

  it('fails with exit 1 naming the invalid variable but not its value', () => {
    const res = run({ NODE_ENV: 'development', SESSION_SECRET: 'sentinel-bad-value' });
    expect(res.status).toBe(1);
    expect(res.stdout).toMatch(/invalid\s+SESSION_SECRET/);
    expect(res.stdout).toContain('config:check FAILED');
    expect(res.stdout + res.stderr).not.toContain('sentinel-bad-value');
  });

  it('loads .env outside production but not in production', () => {
    const dev = run({ NODE_ENV: 'development' });
    expect(dev.stdout).toMatch(/ok\s+DATABASE_URL/);
    const prod = run({ NODE_ENV: 'production' });
    expect(prod.status).toBe(1);
    expect(prod.stdout).toMatch(/missing\s+DATABASE_URL/);
  });
});
