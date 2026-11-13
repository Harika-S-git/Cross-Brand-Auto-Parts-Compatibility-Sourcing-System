// Creates .env.local with a random JWT secret.   Usage:
//   npm run env:init -- <postgres-password> [db-user] [db-name]
// The password is stored URL-encoded, so special characters like @ # / are safe.
import fs from 'node:fs';
import crypto from 'node:crypto';

const [password = 'postgres', user = 'postgres', db = 'autoparts'] = process.argv.slice(2);
if (fs.existsSync('.env.local') && !process.argv.includes('--force')) {
  console.log('.env.local already exists - not overwritten. Edit it by hand, or add --force to replace it.');
  process.exit(0);
}
const out = `DATABASE_URL=postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@localhost:5432/${db}
JWT_SECRET=${crypto.randomBytes(32).toString('hex')}
# transformers = real semantic model (downloads ~23MB once) | hash = offline fallback
EMBEDDING_PROVIDER=transformers
MIN_SIMILARITY=0.30
SEED_PASSWORD=Passw0rd!
`;
fs.writeFileSync('.env.local', out);
console.log(`Created .env.local  (db user "${user}", database "${db}").\nNext: npm run db:setup && npm run db:seed && npm run dev`);
