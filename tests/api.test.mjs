// HTTP-level tests (auth, RBAC, search, ordering). Start the app first:  npm run dev  (or build + start)
// Skipped automatically when the app is not reachable.  TEST_BASE_URL defaults to http://localhost:3000
import test from 'node:test';
import assert from 'node:assert/strict';

const BASE = process.env.TEST_BASE_URL || 'http://localhost:3000';
const PW = process.env.SEED_PASSWORD || 'Passw0rd!';
const up = await fetch(BASE + '/api/auth/me').then(() => true).catch(() => false);
const t = (name, fn) => test(name, { skip: !up && 'app not running' }, fn);

async function login(email, password = PW) {
  const r = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
  return { status: r.status, cookie: (r.headers.get('set-cookie') || '').split(';')[0] };
}
const call = (cookie, path, opts = {}) => fetch(BASE + path, { ...opts, headers: { 'Content-Type': 'application/json', cookie, ...(opts.headers || {}) } });

t('TC15 AUTH: wrong password -> 401, correct -> 200 + httpOnly cookie', async () => {
  assert.equal((await login('buyer@garage.example', 'nope')).status, 401);
  const ok = await login('buyer@garage.example');
  assert.equal(ok.status, 200); assert.ok(ok.cookie.startsWith('session='));
});

t('TC16 AUTH: unauthenticated API call -> 401', async () => assert.equal((await fetch(BASE + '/api/search?q=alternator')).status, 401));

t('TC17 RBAC: buyer cannot reach staff APIs; staff cannot place orders', async () => {
  const b = await login('buyer@garage.example'), s = await login('staff@bosch.example');
  assert.equal((await call(b.cookie, '/api/staff/inventory')).status, 403);
  assert.equal((await call(s.cookie, '/api/orders', { method: 'POST', body: JSON.stringify({ items: [{ partId: 1, quantity: 1 }] }) })).status, 403);
});

t('TC18 SEARCH: plain-language query returns cross-brand compatible alternators', async () => {
  const b = await login('buyer@garage.example');
  const d = await (await call(b.cookie, '/api/search?q=' + encodeURIComponent('alternator for 2015 Civic, need 90A or higher'))).json();
  assert.equal(d.interpreted.minAmp, 90); assert.deepEqual(d.interpreted.vehicles, ['Honda Civic 2015 1.8L']);
  assert.ok(new Set(d.results.map((r) => r.brand)).size >= 4);
  assert.ok(d.results.every((r) => r.category === 'Alternator'));
});

t('TC19 SEARCH: input validation (too short query -> 400)', async () => {
  const b = await login('buyer@garage.example');
  assert.equal((await call(b.cookie, '/api/search?q=a')).status, 400);
});

t('TC20 ORDER: multi-supplier order commits atomically and decrements stock', async () => {
  const b = await login('buyer@garage.example'), s = await login('staff@bosch.example');
  const inv = async () => (await (await call(s.cookie, '/api/staff/inventory')).json()).parts;
  const boschPart = (await inv()).find((p) => p.quantity > 10);
  const other = (await (await call(b.cookie, '/api/search?q=' + encodeURIComponent('oil filter for Corolla'))).json()).results.find((r) => r.supplier_id !== 2 && r.stock > 5);
  const r = await call(b.cookie, '/api/orders', { method: 'POST', body: JSON.stringify({ items: [{ partId: boschPart.part_id, quantity: 2 }, { partId: other.part_id, quantity: 1 }] }) });
  assert.equal(r.status, 201);
  const after = (await inv()).find((p) => p.part_id === boschPart.part_id);
  assert.equal(after.quantity, boschPart.quantity - 2);
});

t('TC21 ORDER: insufficient stock on any line -> 409 and NOTHING is committed', async () => {
  const b = await login('buyer@garage.example'), s = await login('staff@bosch.example');
  const parts = (await (await call(s.cookie, '/api/staff/inventory')).json()).parts;
  const good = parts.find((p) => p.quantity > 10), scarce = parts.find((p) => p.part_id !== good.part_id);
  const r = await call(b.cookie, '/api/orders', { method: 'POST', body: JSON.stringify({ items: [{ partId: good.part_id, quantity: 1 }, { partId: scarce.part_id, quantity: 999 }] }) });
  assert.equal(r.status, 409);
  const goodAfter = (await (await call(s.cookie, '/api/staff/inventory')).json()).parts.find((p) => p.part_id === good.part_id);
  assert.equal(goodAfter.quantity, good.quantity, 'first line was rolled back');
});

t('TC22 STAFF: cannot edit another supplier\'s part (row-level authorisation)', async () => {
  const s = await login('staff@bosch.example');
  const r = await call(s.cookie, '/api/staff/inventory/1', { method: 'PATCH', body: JSON.stringify({ quantity: 999 }) }); // part 1 = OEM supplier
  assert.equal(r.status, 403);
});

t('TC23 STAFF: stock edit below threshold raises an alert via trigger; DB rejects negative stock', async () => {
  const s = await login('staff@bosch.example');
  const p = (await (await call(s.cookie, '/api/staff/inventory')).json()).parts[0];
  assert.equal((await call(s.cookie, `/api/staff/inventory/${p.part_id}`, { method: 'PATCH', body: JSON.stringify({ quantity: -5 }) })).status, 400);
  await call(s.cookie, `/api/staff/inventory/${p.part_id}`, { method: 'PATCH', body: JSON.stringify({ quantity: 0 }) });
  const alerts = (await (await call(s.cookie, '/api/staff/alerts')).json()).alerts;
  assert.ok(alerts.some((a) => a.part_id === p.part_id));
  await call(s.cookie, `/api/staff/inventory/${p.part_id}`, { method: 'PATCH', body: JSON.stringify({ quantity: p.quantity > 10 ? p.quantity : 40 }) });
});
