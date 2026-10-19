import pg from 'pg';

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is not set. Copy .env.example to .env.local and configure it.');
}

// One pool per server process (survives Next.js hot reloads in dev)
const g = globalThis;
export const pool = g.__pgPool || new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 10 });
if (process.env.NODE_ENV !== 'production') g.__pgPool = pool;

export const query = (text, params) => pool.query(text, params);

/** Run fn(client) inside BEGIN/COMMIT; ROLLBACK on any error. */
export async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
