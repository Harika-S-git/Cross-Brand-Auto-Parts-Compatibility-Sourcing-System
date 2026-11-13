// Database-level tests: constraints, trigger, view, stored function, transaction rollback.
// Run: npm test   (needs DATABASE_URL; uses the seeded database and cleans up after itself)
import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { pgConfig } from '../lib/dbConfig.js';
import { embed, toPgVector } from '../lib/embed.js';

const pool = new pg.Pool(pgConfig());
test.after(() => pool.end());
const rejects = (sql, params, code) =>
  assert.rejects(pool.query(sql, params), (e) => { assert.equal(e.code, code, e.message); return true; });

test('TC01 CHECK: negative stock is rejected by the database', () =>
  rejects('UPDATE inventory SET quantity = -1 WHERE part_id = 1', [], '23514'));

test('TC02 CHECK: invalid email is rejected', () =>
  rejects(`INSERT INTO users(name,email,password_hash,role) VALUES ('x','not-an-email','h','buyer')`, [], '23514'));

test('TC03 CHECK: staff without supplier / buyer with supplier is rejected', async () => {
  await rejects(`INSERT INTO users(name,email,password_hash,role) VALUES ('x','a@b.co','h','staff')`, [], '23514');
  await rejects(`INSERT INTO users(name,email,password_hash,role,supplier_id) VALUES ('x','a@b.co','h','buyer',1)`, [], '23514');
});

test('TC04 CHECK: invalid role is rejected', () =>
  rejects(`INSERT INTO users(name,email,password_hash,role) VALUES ('x','c@d.co','h','admin')`, [], '23514'));

test('TC05 UNIQUE: duplicate (supplier, part_number) is rejected', async () => {
  const { rows } = await pool.query('SELECT supplier_id, part_number, category_id FROM parts LIMIT 1');
  await rejects(`INSERT INTO parts(supplier_id,category_id,brand,part_number,name,description) VALUES ($1,$2,'b',$3,'n','d')`,
    [rows[0].supplier_id, rows[0].category_id, rows[0].part_number], '23505');
});

test('TC06 FK: order item referencing a missing part is rejected', () =>
  rejects('INSERT INTO order_items(order_id,part_id,quantity,unit_price) VALUES (1, 999999, 1, 10)', [], '23503'));

test('TC07 CHECK: zero/negative price tier is rejected', () =>
  rejects('INSERT INTO price_tiers(part_id,min_qty,unit_price) VALUES (1, 100, 0)', [], '23514'));

test('TC08 TRIGGER: dropping stock below threshold raises ONE alert; restocking resolves it', async () => {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query('UPDATE inventory SET quantity = 100, reorder_threshold = 5 WHERE part_id = 10');
    const open0 = (await c.query('SELECT COUNT(*) n FROM stock_alerts WHERE part_id=10 AND NOT resolved')).rows[0].n;
    assert.equal(open0, '0');
    await c.query('UPDATE inventory SET quantity = 3 WHERE part_id = 10');
    await c.query('UPDATE inventory SET quantity = 2 WHERE part_id = 10');           // no duplicate alert
    assert.equal((await c.query('SELECT COUNT(*) n FROM stock_alerts WHERE part_id=10 AND NOT resolved')).rows[0].n, '1');
    await c.query('UPDATE inventory SET quantity = 50 WHERE part_id = 10');          // auto-resolve
    assert.equal((await c.query('SELECT COUNT(*) n FROM stock_alerts WHERE part_id=10 AND NOT resolved')).rows[0].n, '0');
  } finally { await c.query('ROLLBACK'); c.release(); }
});

test('TC09 FUNCTION: get_unit_price applies the correct volume tier', async () => {
  const { rows } = await pool.query(`SELECT get_unit_price(1,1) p1, get_unit_price(1,5) p5, get_unit_price(1,20) p20, get_unit_price(1,100) p100`);
  const r = rows[0];
  assert.ok(Number(r.p1) > Number(r.p5) && Number(r.p5) > Number(r.p20) && r.p20 === r.p100);
});

test('TC10 VIEW: v_vehicle_compatible_parts summarises suppliers/brands per vehicle', async () => {
  const { rows } = await pool.query(`SELECT * FROM v_vehicle_compatible_parts WHERE model='Civic' AND year=2015 AND category='Alternator'`);
  assert.equal(rows.length, 1);
  assert.ok(Number(rows[0].brands) >= 4 && Number(rows[0].compatible_parts) >= 4);
});

test('TC11 VECTOR: rank_matches returns compatible, cross-brand, score-ordered alternators', async () => {
  const vec = toPgVector(await embed('alternator for 2015 Civic, need 90A or higher'));
  const veh = (await pool.query(`SELECT array_agg(vehicle_id) ids FROM vehicles WHERE model='Civic' AND year=2015`)).rows[0].ids;
  const { rows } = await pool.query('SELECT * FROM rank_matches($1::vector, $2::int[], 90, 0.2, 10)', [vec, veh]);
  assert.ok(rows.length >= 4);
  assert.ok(new Set(rows.map((r) => r.brand)).size >= 4, 'multiple brands returned');
  assert.ok(rows.every((r) => r.category === 'Alternator' && r.specs.amperage >= 90));
  const scores = rows.map((r) => Number(r.score));
  assert.deepEqual(scores, [...scores].sort((a, b) => b - a));
});

test('TC12 FULL-TEXT: keyword search works for exact words', async () => {
  const { rowCount } = await pool.query(`SELECT 1 FROM parts WHERE search_tsv @@ websearch_to_tsquery('english','bosch alternator')`);
  assert.ok(rowCount > 0);
});

test('TC13 TRANSACTION: failure on the 2nd line rolls back the whole multi-supplier order', async () => {
  const c = await pool.connect();
  const before = (await c.query('SELECT quantity FROM inventory WHERE part_id IN (1,2) ORDER BY part_id')).rows.map((r) => r.quantity);
  const orders0 = (await c.query('SELECT COUNT(*) n FROM orders')).rows[0].n;
  try {
    await c.query('BEGIN');
    const o = (await c.query(`INSERT INTO orders(buyer_id) VALUES (3) RETURNING order_id`)).rows[0].order_id;
    await c.query('UPDATE inventory SET quantity = quantity - 1 WHERE part_id = 1');
    await c.query('INSERT INTO order_items(order_id,part_id,quantity,unit_price) VALUES ($1,1,1,100)', [o]);
    await c.query('UPDATE inventory SET quantity = quantity - 100000 WHERE part_id = 2');   // violates CHECK -> error
    assert.fail('should not reach');
  } catch (e) {
    assert.equal(e.code, '23514');
    await c.query('ROLLBACK');
  }
  const after = (await c.query('SELECT quantity FROM inventory WHERE part_id IN (1,2) ORDER BY part_id')).rows.map((r) => r.quantity);
  assert.deepEqual(after, before, 'stock unchanged');
  assert.equal((await c.query('SELECT COUNT(*) n FROM orders')).rows[0].n, orders0, 'no orphan order');
  c.release();
});

test('TC14 SECURITY: passwords are stored as bcrypt hashes', async () => {
  const { rows } = await pool.query('SELECT password_hash FROM users');
  assert.ok(rows.length > 0 && rows.every((r) => /^\$2[aby]\$\d{2}\$/.test(r.password_hash)));
});
