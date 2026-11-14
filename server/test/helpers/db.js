import { config } from 'dotenv';
import { createPool } from '../../src/db/pool.js';
import { runMigrations } from '../../src/db/migrate.js';

config({ quiet: true });

/** True when integration tests can run against the test database. */
export const hasTestDb = Boolean(process.env.TEST_DATABASE_URL);

/**
 * Identifies the database a URL points at: host (pooler suffix removed) plus database name.
 * Returns null when the URL cannot be parsed.
 * @param {string} url
 * @returns {string | null}
 */
export function databaseIdentity(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase().replace('-pooler', '');
    return `${host}:${u.port || '5432'}${u.pathname}`;
  } catch {
    return null;
  }
}

/**
 * Creates a pool on TEST_DATABASE_URL, wipes the public schema, and migrates.
 * Refuses to run if the test URL is missing or unparseable, or points at the same database
 * as DATABASE_URL, so it can never wipe the development branch.
 * @returns {Promise<import('pg').Pool>}
 */
export async function resetTestDatabase() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error('TEST_DATABASE_URL is not set');
  const testId = databaseIdentity(url);
  if (!testId) throw new Error('TEST_DATABASE_URL is not a valid URL');
  const devUrl = process.env.DATABASE_URL;
  if (devUrl) {
    const devId = databaseIdentity(devUrl);
    if (!devId || devId === testId) {
      throw new Error('TEST_DATABASE_URL must point at a different database than DATABASE_URL');
    }
  }
  const pool = createPool(url);
  // IF EXISTS: an earlier run killed between DROP and CREATE must not wedge every later run.
  await pool.query('DROP SCHEMA IF EXISTS public CASCADE');
  await pool.query('CREATE SCHEMA public');
  await runMigrations(pool);
  return pool;
}
