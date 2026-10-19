// Applies db/*.sql in order using DATABASE_URL (no psql needed).
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';

const dir = path.resolve('db');
const files = fs.readdirSync(dir).filter((f) => /^\d+_.*\.sql$/.test(f)).sort();
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  for (const f of files) {
    process.stdout.write(`Applying ${f} ... `);
    await client.query(fs.readFileSync(path.join(dir, f), 'utf8'));
    console.log('ok');
  }
} finally {
  await client.end();
}
