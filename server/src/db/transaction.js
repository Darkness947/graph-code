/**
 * Runs `fn` with a client inside a transaction; rolls back and rethrows on any error.
 * @template T
 * @param {import('pg').Pool} pool
 * @param {(client: import('pg').PoolClient) => Promise<T>} fn
 * @param {string} [begin] the statement that opens the transaction (a code constant, never input)
 * @returns {Promise<T>}
 */
export async function withTransaction(pool, fn, begin = 'BEGIN') {
  const client = await pool.connect();
  try {
    await client.query(begin);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
