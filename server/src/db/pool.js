import pg from 'pg';

/**
 * Creates a pg pool for a connection string. Neon requires TLS, which the connection string
 * requests with `sslmode=require`. Never log the string.
 * @param {string} connectionString
 * @returns {import('pg').Pool}
 */
export function createPool(connectionString) {
  return new pg.Pool({ connectionString, max: 5 });
}
