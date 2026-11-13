// Diagnoses the database setup step by step:  npm run db:check
import pg from 'pg';
import { pgConfig, explainDbError } from '../lib/dbConfig.js';

const ok = (m) => console.log('  ✔ ' + m);
const no = (m) => { console.log('  ✖ ' + m); process.exitCode = 1; };

console.log('Checking AutoParts database setup\n');
let cfg;
try { cfg = pgConfig(); ok(`config found  (user=${cfg.user}, host=${cfg.host}:${cfg.port}, db=${cfg.database})`); }
catch (e) { no(e.message); process.exit(1); }
if (!process.env.JWT_SECRET) no('JWT_SECRET is missing in .env.local (run: npm run env:init)'); else ok('JWT_SECRET set');

const client = new pg.Client(cfg);
try { await client.connect(); ok('connected to PostgreSQL'); }
catch (e) { no((explainDbError(e)?.msg) || e.message); process.exit(1); }

try {
  const ext = await client.query("SELECT extversion FROM pg_extension WHERE extname='vector'");
  ext.rowCount ? ok(`pgvector ${ext.rows[0].extversion} installed`) : no('pgvector extension missing -> run: npm run db:setup (and install pgvector, see README)');
  const t = await client.query("SELECT count(*)::int n FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('users','parts','suppliers','orders','inventory')");
  t.rows[0].n === 5 ? ok('tables exist') : no('tables missing -> run: npm run db:setup');
  if (t.rows[0].n === 5) {
    const c = await client.query('SELECT (SELECT count(*)::int FROM parts) parts, (SELECT count(*)::int FROM users) users');
    c.rows[0].parts > 0 ? ok(`seed data present (${c.rows[0].parts} parts, ${c.rows[0].users} users)`) : no('no data -> run: npm run db:seed');
  }
} catch (e) { no(e.message); }
await client.end();
console.log(process.exitCode ? '\nFix the ✖ items above, then re-run: npm run db:check' : '\nAll good. Start the app with: npm run dev');
