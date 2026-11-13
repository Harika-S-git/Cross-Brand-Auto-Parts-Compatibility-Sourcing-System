// Applies db/*.sql in order (no psql needed). Creates the database first if it does not exist.
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { pgConfig, explainDbError } from '../lib/dbConfig.js';

const fail = (err) => {
  const f = explainDbError(err);
  console.error('\n✖ ' + (f ? f.msg : err.message));
  if (!f) console.error(err);
  process.exit(1);
};

const cfg = pgConfig();
const dir = path.resolve('db');
const files = fs.readdirSync(dir).filter((f) => /^\d+_.*\.sql$/.test(f)).sort();

async function ensureDatabase() {
  const admin = new pg.Client({ ...cfg, database: 'postgres' });
  await admin.connect();
  try {
    const { rowCount } = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [cfg.database]);
    if (!rowCount) {
      process.stdout.write(`Creating database "${cfg.database}" ... `);
      await admin.query(`CREATE DATABASE "${cfg.database.replace(/"/g, '""')}"`);
      console.log('ok');
    }
  } finally { await admin.end(); }
}

try {
  await ensureDatabase();
  const client = new pg.Client(cfg);
  await client.connect();
  try {
    for (const f of files) {
      process.stdout.write(`Applying ${f} ... `);
      await client.query(fs.readFileSync(path.join(dir, f), 'utf8'));
      console.log('ok');
    }
  } finally { await client.end(); }
  console.log('\n✔ Database ready. Next: npm run db:seed');
} catch (e) { fail(e); }
