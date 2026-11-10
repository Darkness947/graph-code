import process from 'node:process';
import { createPool } from './pool.js';
import { runMigrations } from './migrate.js';

/**
 * Shared entry point for `db:migrate` and `db:check`.
 * Uses DATABASE_URL, or TEST_DATABASE_URL with the `--test` flag. Loads `.env` outside
 * production. Prints names and counts only, never connection strings.
 */
async function main() {
  const command = process.argv[2];
  const useTest = process.argv.includes('--test');
  if (process.env.NODE_ENV !== 'production') {
    const { config } = await import('dotenv');
    config({ quiet: true });
  }
  const varName = useTest ? 'TEST_DATABASE_URL' : 'DATABASE_URL';
  const url = process.env[varName];
  if (!url) {
    console.error(`${varName} is not set. See server/.env.example.`);
    process.exit(1);
  }
  const pool = createPool(url);
  try {
    if (command === 'check') {
      const { rows } = await pool.query(
        `SELECT version() AS version,
                current_database() AS db,
                (SELECT count(*)::int FROM pg_extension WHERE extname = 'ltree') AS ltree`,
      );
      console.log(`[${varName}] connected to database "${rows[0].db}"`);
      console.log(rows[0].version);
      console.log(`ltree extension installed: ${rows[0].ltree === 1}`);
    } else if (command === 'migrate') {
      const applied = await runMigrations(pool);
      console.log(
        applied.length
          ? `[${varName}] applied: ${applied.join(', ')}`
          : `[${varName}] nothing to apply`,
      );
      const { rows } = await pool.query(
        `SELECT table_name FROM information_schema.tables
          WHERE table_schema = 'public' ORDER BY table_name`,
      );
      console.log(`tables: ${rows.map((r) => r.table_name).join(', ')}`);
    } else {
      console.error('Usage: node src/db/cli.js <check|migrate> [--test]');
      process.exit(1);
    }
  } catch (err) {
    console.error(`[${varName}] failed: ${err.message}`);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main();
