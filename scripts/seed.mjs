// Seeds suppliers, vehicles, ~70 cross-brand parts (inconsistent naming on purpose), tiers,
// stock, demo users and a few historical orders. Embeddings are computed per EMBEDDING_PROVIDER.
import pg from 'pg';
import bcrypt from 'bcryptjs';
import { embed, toPgVector, buildPartText } from '../lib/embed.js';

const rng = (() => { let a = 20240607; return () => { a |= 0; a = (a + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; })();
const rint = (a, b) => Math.floor(rng() * (b - a + 1)) + a;
const letters = (n) => Array.from({ length: n }, () => 'ABCDEFGHJKLMNPRSTUVWXYZ'[rint(0, 22)]).join('');

const suppliers = [
  { name: 'Sunrise OEM Parts', email: 'sales@sunrise-oem.example', city: 'Bengaluru', lead: 2, brand: 'OEM', style: 0, mult: 1.35 },
  { name: 'Bosch Distribution India', email: 'orders@bosch-dist.example', city: 'Chennai', lead: 3, brand: 'Bosch', style: 1, mult: 1.15 },
  { name: 'Denso Trade Hub', email: 'trade@densohub.example', city: 'Pune', lead: 4, brand: 'Denso', style: 2, mult: 1.1 },
  { name: 'Valeo Auto Partners', email: 'hello@valeo-partners.example', city: 'Mumbai', lead: 3, brand: 'Valeo', style: 1, mult: 1.05 },
  { name: 'Bharat Aftermarket Co', email: 'care@bharat-am.example', city: 'Delhi', lead: 1, brand: 'Uno Minda', style: 3, mult: 0.85 },
  { name: 'QuickFit Spares', email: 'info@quickfit.example', city: 'Bengaluru', lead: 1, brand: 'QuickFit', style: 4, mult: 0.7 },
];

const vehicles = [
  ['Honda', 'Civic', 2015, '1.8L'], ['Honda', 'Civic', 2014, '1.8L'], ['Honda', 'City', 2015, '1.5L'],
  ['Honda', 'Accord', 2015, '2.4L'], ['Toyota', 'Corolla', 2015, '1.8L'], ['Toyota', 'Camry', 2015, '2.5L'],
  ['Maruti Suzuki', 'Swift', 2015, '1.2L'], ['Hyundai', 'i20', 2015, '1.2L'],
  ['Ford', 'Focus', 2015, '2.0L'], ['Volkswagen', 'Polo', 2015, '1.6L'],
].map(([make, model, year, engine]) => ({ make, model, year, engine }));

const categories = ['Alternator', 'Brake Pads', 'Oil Filter', 'Spark Plug', 'Air Filter', 'Starter Motor'];
const abbr = { Alternator: 'ALT', 'Brake Pads': 'BRK', 'Oil Filter': 'OF', 'Spark Plug': 'SPK', 'Air Filter': 'AF', 'Starter Motor': 'STR' };

// base concepts: what the part REALLY is, independent of how each brand catalogs it
const concepts = [
  { cat: 'Alternator', label: '90A', amp: 90, fits: [0, 1], base: 7800 },
  { cat: 'Alternator', label: '110A', amp: 110, fits: [0, 1], base: 9200 },
  { cat: 'Alternator', label: '70A', amp: 70, fits: [2], base: 6900 },
  { cat: 'Alternator', label: '100A', amp: 100, fits: [3], base: 10400 },
  { cat: 'Alternator', label: '80A', amp: 80, fits: [4], base: 7500 },
  { cat: 'Alternator', label: '120A', amp: 120, fits: [5], base: 11800 },
  { cat: 'Brake Pads', label: 'front set ceramic', fits: [0, 1, 2], base: 2400 },
  { cat: 'Brake Pads', label: 'front set semi-metallic', fits: [4, 5], base: 2200 },
  { cat: 'Brake Pads', label: 'front set ceramic', fits: [6, 7], base: 1700 },
  { cat: 'Oil Filter', label: 'spin-on', fits: [0, 1, 2, 3], base: 380 },
  { cat: 'Oil Filter', label: 'spin-on', fits: [4, 5], base: 340 },
  { cat: 'Spark Plug', label: 'iridium set of 4', fits: [0, 1, 2, 3], base: 2600 },
  { cat: 'Spark Plug', label: 'iridium set of 4', fits: [4, 5], base: 2450 },
  { cat: 'Air Filter', label: 'panel type', fits: [0, 1, 2], base: 620 },
  { cat: 'Starter Motor', label: '1.0kW', fits: [0, 1, 2], base: 6400 },
];

const fitText = (c) => c.fits.map((i) => `${vehicles[i].make} ${vehicles[i].model} ${vehicles[i].year} ${vehicles[i].engine}`).join(', ');
const models = (c) => [...new Set(c.fits.map((i) => vehicles[i].model))].join('/');
const short = (c) => c.fits.map((i) => vehicles[i].model.slice(0, 3).toUpperCase() + String(vehicles[i].year).slice(2)).join('/');

const v12 = (c) => (['Alternator', 'Starter Motor'].includes(c.cat) ? ' 12V' : '');
const styles = [
  (c, b) => ({ name: `${c.cat.toUpperCase()} ASSY ${c.label.toUpperCase()}`, desc: `GENUINE ${c.cat.toUpperCase()} ${c.label.toUpperCase()} FOR ${models(c).toUpperCase()} ${[...new Set(c.fits.map((i) => vehicles[i].year))].join('-')}` }),
  (c, b) => ({ name: `${b} ${c.cat} ${c.label}${v12(c)}`, desc: `${b} ${c.cat.toLowerCase()} rated ${c.label}, direct replacement suitable for ${fitText(c)}. Tested to OE specification.` }),
  (c, b) => ({ name: `${abbr[c.cat]}-${short(c).split('/')[0]}-${c.label.replace(/\W+/g, '').slice(0, 5).toUpperCase()}`, desc: `${abbr[c.cat]} ${c.label} ${short(c)}` }),
  (c, b) => ({ name: `Replacement ${c.cat} (${c.label})`, desc: `Aftermarket ${c.cat.toLowerCase()} unit, ${c.label}; fits ${fitText(c)}. 1 year warranty.` }),
  (c, b) => ({ name: `${c.cat} ${c.label} - ${models(c)} compatible`, desc: `Budget friendly ${c.label} ${c.cat.toLowerCase()} for ${models(c)} engines, plug and play.` }),
];

const pnPrefix = [() => `${rint(10000, 99999)}-R${letters(2)}-A0${rint(1, 9)}`, () => `0 ${rint(100, 999)} ${rint(100, 999)} ${rint(100, 999)}`,
  () => `${rint(100, 999)}-${rint(1000, 9999)}`, () => `VA${rint(100000, 999999)}`, () => `UM-${letters(3)}${rint(100, 999)}`, () => `QF${rint(1000, 9999)}${letters(1)}`];

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const client = await pool.connect();
try {
  await client.query('BEGIN');
  await client.query('TRUNCATE stock_alerts, order_items, orders, price_tiers, inventory, part_compatibility, parts, vehicles, categories, users, suppliers RESTART IDENTITY CASCADE');

  for (const s of suppliers) {
    const r = await client.query('INSERT INTO suppliers(name, contact_email, city, lead_time_days) VALUES ($1,$2,$3,$4) RETURNING supplier_id', [s.name, s.email, s.city, s.lead]);
    s.id = r.rows[0].supplier_id;
  }
  for (const c of categories) await client.query('INSERT INTO categories(name) VALUES ($1)', [c]);
  const catId = Object.fromEntries((await client.query('SELECT category_id, name FROM categories')).rows.map((r) => [r.name, r.category_id]));
  for (const v of vehicles) {
    v.id = (await client.query('INSERT INTO vehicles(make, model, year, engine) VALUES ($1,$2,$3,$4) RETURNING vehicle_id', [v.make, v.model, v.year, v.engine])).rows[0].vehicle_id;
  }

  // users (bcrypt-hashed demo passwords)
  const hash = await bcrypt.hash(process.env.SEED_PASSWORD || 'Passw0rd!', 10);
  const users = [['Sunrise Staff', 'staff@sunrise.example', 'staff', 1], ['Bosch Staff', 'staff@bosch.example', 'staff', 2],
    ['Ravi (Ravi Motors)', 'buyer@garage.example', 'buyer', null], ['Meena (City Auto Works)', 'buyer2@garage.example', 'buyer', null]];
  for (const [n, e, r, sid] of users) await client.query('INSERT INTO users(name,email,password_hash,role,supplier_id) VALUES ($1,$2,$3,$4,$5)', [n, e, hash, r, sid]);

  // parts
  let count = 0;
  for (const [ci, c] of concepts.entries()) {
    for (const [si, s] of suppliers.entries()) {
      if (rng() < 0.12) continue;                       // not every supplier stocks every concept
      const { name, desc } = styles[s.style](c, s.brand);
      const fitVehicles = c.fits.map((i) => vehicles[i]);
      const text = buildPartText({ brand: s.brand, name, description: desc, category: c.cat, vehicles: fitVehicles });
      const vec = toPgVector(await embed(text));
      const specs = c.amp ? { amperage: c.amp } : {};
      const pr = await client.query(
        `INSERT INTO parts(supplier_id, category_id, brand, part_number, name, description, specs, embedding, warranty_months)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8::vector,$9) RETURNING part_id`,
        [s.id, catId[c.cat], s.brand, pnPrefix[si]() + `${ci}`, name, desc, specs, vec, s.style >= 3 ? 12 : 24]);
      const pid = pr.rows[0].part_id;
      for (const v of fitVehicles) await client.query('INSERT INTO part_compatibility(part_id, vehicle_id, fitment_notes) VALUES ($1,$2,$3)', [pid, v.id, `Verified fitment: ${v.make} ${v.model} ${v.year} ${v.engine}`]);
      const price = Math.round(c.base * s.mult * (0.95 + rng() * 0.1));
      for (const [mq, f] of [[1, 1], [5, 0.94], [20, 0.88]]) await client.query('INSERT INTO price_tiers(part_id,min_qty,unit_price) VALUES ($1,$2,$3)', [pid, mq, Math.round(price * f)]);
      let qty = rint(0, 60); const thr = c.cat === 'Alternator' ? 5 : 10;
      if (c.label === '90A' && s.brand === 'QuickFit') qty = 2;          // demo: low-stock alert fires
      if (c.label === '90A' && s.brand === 'Denso') qty = 0;             // demo: out of stock
      await client.query('INSERT INTO inventory(part_id, quantity, reorder_threshold) VALUES ($1,$2,$3)', [pid, qty, thr]);
      count++;
    }
  }

  // a few historical orders (multi-supplier) so staff reports have data
  const tierPrice = async (pid, q) => Number((await client.query('SELECT get_unit_price($1,$2) AS p', [pid, q])).rows[0].p);
  const parts = (await client.query('SELECT part_id FROM parts ORDER BY part_id')).rows.map((r) => r.part_id);
  for (const buyer of [3, 4, 3, 4, 3]) {
    const o = (await client.query('INSERT INTO orders(buyer_id) VALUES ($1) RETURNING order_id', [buyer])).rows[0].order_id;
    const chosen = new Set(); while (chosen.size < rint(2, 4)) chosen.add(parts[rint(0, parts.length - 1)]);
    let total = 0;
    for (const pid of chosen) { const q = rint(1, 6); const p = await tierPrice(pid, q); total += p * q;
      await client.query('INSERT INTO order_items(order_id,part_id,quantity,unit_price) VALUES ($1,$2,$3,$4)', [o, pid, q, p]); }
    await client.query('UPDATE orders SET total_amount=$1 WHERE order_id=$2', [total, o]);
  }
  await client.query('COMMIT');
  console.log(`Seeded ${suppliers.length} suppliers, ${vehicles.length} vehicles, ${count} parts (embedding: ${process.env.EMBEDDING_PROVIDER || 'transformers'}).`);
  console.log('Demo logins (password = SEED_PASSWORD): staff@sunrise.example, staff@bosch.example (staff) | buyer@garage.example, buyer2@garage.example (buyer)');
} catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); await pool.end(); }
