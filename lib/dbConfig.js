// Single source of truth for PostgreSQL connection settings (used by the app, scripts and tests).
//
// Two ways to configure (in .env.local):
//   1) DATABASE_URL=postgresql://USER:PASSWORD@HOST:PORT/DBNAME
//   2) DB_HOST / DB_PORT / DB_USER / DB_PASSWORD / DB_NAME   (safest if the password has special characters)
//
// The URL parser below is deliberately tolerant: a password containing @ # / ? : (not percent-encoded)
// would normally break a connection string and surface as "password authentication failed".

export function parseDatabaseUrl(url) {
  const m = /^postgres(?:ql)?:\/\/([^:/@]*)(?::(.*))?@([^@/?#]+)(?:\/([^?]*))?(?:\?.*)?$/.exec(url.trim());
  if (!m) return null;
  const [, user, rawPassword = '', hostPort, db = ''] = m;
  const safeDecode = (s) => { try { return decodeURIComponent(s); } catch { return s; } };
  const [host, port] = hostPort.split(':');
  return {
    host: host || 'localhost',
    port: port ? Number(port) : 5432,
    user: safeDecode(user),
    password: safeDecode(rawPassword),
    database: safeDecode(db) || undefined,
  };
}

class ConfigError extends Error {
  constructor(m) { super(m); this.userMessage = m; this.status = 503; }
}

export function pgConfig(overrides = {}) {
  const e = process.env;
  let cfg;
  if (e.DB_HOST || e.DB_USER || e.DB_PASSWORD || e.DB_NAME) {
    cfg = {
      host: e.DB_HOST || 'localhost',
      port: Number(e.DB_PORT || 5432),
      user: e.DB_USER || 'postgres',
      password: e.DB_PASSWORD ?? '',
      database: e.DB_NAME || 'autoparts',
    };
  } else if (e.DATABASE_URL) {
    cfg = parseDatabaseUrl(e.DATABASE_URL);
    if (!cfg) throw new ConfigError('DATABASE_URL is malformed. Expected: postgresql://USER:PASSWORD@localhost:5432/autoparts');
  } else {
    throw new ConfigError('Database is not configured. Create .env.local (run: npm run env:init) and set DATABASE_URL.');
  }
  return { ...cfg, ...overrides };
}

/** Human-readable explanation + fix for the most common PostgreSQL / network failures. */
export function explainDbError(err) {
  const c = err?.code;
  if (c === '28P01' || c === '28000')
    return { status: 503, msg: 'Database login failed: the PostgreSQL username or password in .env.local is wrong. Fix DATABASE_URL (or DB_USER/DB_PASSWORD), then restart the server.' };
  if (c === '3D000')
    return { status: 503, msg: 'The database does not exist yet. Run: npm run db:setup (it creates the database and tables).' };
  if (c === '42P01')
    return { status: 503, msg: 'Database tables are missing. Run: npm run db:reset' };
  if (c === '42704' || c === '0A000' || /type "vector" does not exist/.test(err?.message || ''))
    return { status: 503, msg: 'The pgvector extension is not installed in PostgreSQL. Install pgvector (see README) and run: npm run db:setup' };
  if (['ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT', 'EHOSTUNREACH'].includes(c) || err?.errors?.some?.((x) => x.code === 'ECONNREFUSED'))
    return { status: 503, msg: 'Cannot reach PostgreSQL. Make sure the server is running and host/port in .env.local are correct (default localhost:5432).' };
  if (c === '57P03')
    return { status: 503, msg: 'PostgreSQL is starting up or shutting down. Try again in a few seconds.' };
  return null;
}
