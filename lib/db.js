import pg from 'pg';
import { pgConfig } from './dbConfig.js';

// One pool per server process (survives Next.js hot reloads in dev).
// Config is read lazily so a missing .env.local produces a clear API error instead of crashing module load.
const g = globalThis;
function getPool() {
  if (!g.__pgPool) {
    g.__pgPool = new pg.Pool({ ...pgConfig(), max: 10, connectionTimeoutMillis: 8000 });
    // an idle client erroring (e.g. DB restarted) must not crash the whole Node process
    g.__pgPool.on('error', (e) => console.error('[db] idle client error:', e.message));
  }
  return g.__pgPool;
}

export const pool = new Proxy({}, { get: (_, prop) => { const p = getPool(); const v = p[prop]; return typeof v === 'function' ? v.bind(p) : v; } });

export const query = (text, params) => getPool().query(text, params);

/** Run fn(client) inside BEGIN/COMMIT; ROLLBACK on any error. */
export async function withTransaction(fn) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* connection already gone */ }
    throw err;
  } finally {
    client.release();
  }
}
