import { describe, it, expect } from 'vitest';
import { limitsFromConfig } from '../../src/services/ingestion/limits.js';
import { loadConfig } from '../../src/config.js';

const ENV = {
  APP_ORIGIN: 'http://localhost:5173',
  DATABASE_URL: 'postgresql://u:p@localhost/db',
  SESSION_SECRET: 'a'.repeat(64),
  TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'),
  GITHUB_CLIENT_ID: 'id',
  GITHUB_CLIENT_SECRET: 'secret',
};

describe('limitsFromConfig', () => {
  it('carries the spec 4.1 defaults', () => {
    expect(limitsFromConfig(loadConfig(ENV))).toEqual({
      maxZipBytes: 52428800,
      maxZipEntries: 20000,
      maxFileBytes: 1048576,
      maxTotalSourceBytes: 52428800,
      maxCompressionRatio: 100,
      maxSourceFiles: 1000,
    });
  });

  it('follows the environment and is frozen', () => {
    const limits = limitsFromConfig(loadConfig({ ...ENV, MAX_SOURCE_FILES: '5' }));
    expect(limits.maxSourceFiles).toBe(5);
    expect(Object.isFrozen(limits)).toBe(true);
  });
});
