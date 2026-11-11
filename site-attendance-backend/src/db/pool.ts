import pkg from 'pg';
const { Pool, types } = pkg;
import type { PoolClient } from 'pg';
import { getDatabaseUrl } from '../config.js';

// Return DATE columns (work_date) as 'YYYY-MM-DD' instead of a Date at local
// midnight, which shifts the day when serialized as UTC JSON.
types.setTypeParser(types.builtins.DATE, (value) => value);

const pool = new Pool({
  connectionString: getDatabaseUrl(),
  max: Number(process.env.DB_POOL_MAX || 10),
  connectionTimeoutMillis: 5000,
  idleTimeoutMillis: 30000,
});

// An idle client can lose its connection (e.g. PostgreSQL restart). Without this
// listener the error is unhandled and crashes the process.
pool.on('error', (error) => {
  console.error('Unexpected PostgreSQL client error:', error);
});

/** Runs `work` in a transaction: commits when it returns, rolls back when it throws. */
export async function withTransaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export default pool;
