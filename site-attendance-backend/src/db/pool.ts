import pkg from 'pg';
const { Pool, types } = pkg;
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

export default pool;
