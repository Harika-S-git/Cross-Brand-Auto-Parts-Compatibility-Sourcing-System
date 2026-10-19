# Cross-Brand Auto Parts Compatibility & Sourcing System

DBMS Experiential Learning – Level 3 Project · PES University, Dept. of CSE

Mechanics and distributors describe a part in plain language (*"alternator for 2015 Civic, need 90A or higher"*).
The system embeds the query and semantically matches it against part descriptions across **all supplier catalogs**
(OEM, Bosch, Denso, Valeo, Uno Minda, QuickFit …), then ranks cross-brand compatible substitutes by
**similarity + price + stock**, and lets the buyer order from several suppliers in one atomic transaction.

| Layer | Technology |
|---|---|
| Frontend + API | Next.js 14 (App Router, Route Handlers), React 18 |
| Relational DB (mandatory) | PostgreSQL 14+ |
| Vector DB | **pgvector** (HNSW index, cosine distance) inside the same PostgreSQL |
| Embeddings | `Xenova/all-MiniLM-L6-v2` (384-d) via `@xenova/transformers`, runs locally – no API key |
| Auth | bcrypt password hashes, JWT in an httpOnly cookie, roles `staff` / `buyer` |

## Prerequisites
* Node.js **20.6+** (22 recommended)
* PostgreSQL **14+** with the **pgvector** extension available (v0.5+ for HNSW)
  * Windows: install PostgreSQL, then pgvector (https://github.com/pgvector/pgvector#windows) – or use Docker below
  * macOS: `brew install postgresql@16 pgvector` · Ubuntu: `sudo apt install postgresql postgresql-16-pgvector`
  * Docker (any OS): `docker run -d --name pgv -p 5432:5432 -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=autoparts pgvector/pgvector:pg16`

## Setup
```bash
git clone <your-repo-url> && cd autoparts-sourcing
npm install

cp .env.example .env.local        # Windows: copy .env.example .env.local
#  edit .env.local -> set DATABASE_URL (and a long random JWT_SECRET)

npm run db:setup                  # creates tables, indexes, functions, triggers, views (db/*.sql)
npm run db:seed                   # demo suppliers, vehicles, ~80 parts + embeddings, users, orders
npm run dev                       # http://localhost:3000
```
The first seed/search downloads the ~23 MB embedding model once (needs internet) and caches it.
If you are offline, set `EMBEDDING_PROVIDER=hash` in `.env.local` (lightweight fallback), then re-run `npm run db:seed`.
**If you change `EMBEDDING_PROVIDER`, re-seed** – stored vectors and query vectors must come from the same model.

### Demo accounts (password = `SEED_PASSWORD`, default `Passw0rd!`)
| Role | Email | Can do |
|---|---|---|
| Buyer / Mechanic | `buyer@garage.example`, `buyer2@garage.example` | search, compare, order, order history |
| Distributor staff (Sunrise OEM) | `staff@sunrise.example` | manage own inventory & price tiers, alerts, reports |
| Distributor staff (Bosch) | `staff@bosch.example` | same, for the Bosch catalog |

Try searching: `alternator for 2015 Civic, need 90A or higher` – then switch the mode to *Keyword (full-text)* to see
why plain keyword search misses most brands.

## Tests
```bash
npm run db:reset                  # clean seeded data
npm run dev                       # in a second terminal (needed for the API tests)
npm test                          # 14 database tests + 9 HTTP tests (API tests skip if app is down)
# if the app runs on another port:  TEST_BASE_URL=http://localhost:3001 npm test
```

## Project structure
```
db/01_schema.sql                  DDL: tables, constraints, indexes (HNSW, GIN)
db/02_functions_triggers_views.sql  rank_matches(), get_unit_price(), triggers, views
db/03_alter_demo.sql              ALTER / DROP demonstrations
db/queries.sql                    important queries & transaction demo
scripts/setup-db.mjs, seed.mjs    schema runner, data + embedding seeder
lib/                              db pool, embeddings, auth (JWT), query parser, helpers
app/api/**                        Route Handlers (auth, search, orders, staff/*)
app/**/page.js                    UI: login, register, search & order, my orders, staff dashboard
tests/                            node:test suites (database + API)
docs/                             report, ER diagram, architecture, screenshots
```

## Security notes
No secrets in source – everything comes from environment variables (`.env.local` is git-ignored).
Passwords are bcrypt-hashed; all SQL is parameterised; role checks happen server-side in every route handler;
staff can only modify their own supplier's parts; integrity rules live in the database (CHECK / FK / UNIQUE).
