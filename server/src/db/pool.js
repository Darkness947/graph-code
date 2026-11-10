import pg from 'pg';

/**
 * Creates a pg pool for a connection string. Neon requires TLS, which the connection string
 * requests with `sslmode=require`. Never log the string.
 * @param {string} connectionString
 * @returns {import('pg').Pool}
 */
export function createPool(connectionString) {
  const pool = new pg.Pool({ connectionString, max: 5 });
  // Neon drops idle connections; an unhandled 'error' event would crash the process.
  pool.on('error', (err) => {
    console.error('Idle database client error:', err.message);
  });
  return pool;
}
