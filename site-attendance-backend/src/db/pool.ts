import pkg from 'pg';
const { Pool } = pkg;
import { getDatabaseUrl } from '../config.js';

const pool = new Pool({
  connectionString: getDatabaseUrl(),
});

pool.on('connect', () => {
  console.log('Connected to PostgreSQL database!');
});

export default pool;