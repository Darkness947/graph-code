import { createPool } from '../../src/db/pool.js';
import { runMigrations } from '../../src/db/migrate.js';

/** True when integration tests can run against the test database. */
export const hasTestDb = Boolean(process.env.TEST_DATABASE_URL);

/**
 * Creates a pool on TEST_DATABASE_URL, wipes the public schema, and migrates.
 * Refuses to run if the test URL is missing or equals DATABASE_URL, so it can never wipe the
 * development branch.
 * @returns {Promise<import('pg').Pool>}
 */
export async function resetTestDatabase() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error('TEST_DATABASE_URL is not set');
  if (url === process.env.DATABASE_URL) {
    throw new Error('TEST_DATABASE_URL must differ from DATABASE_URL');
  }
  const pool = createPool(url);
  await pool.query('DROP SCHEMA public CASCADE');
  await pool.query('CREATE SCHEMA public');
  await runMigrations(pool);
  return pool;
}
