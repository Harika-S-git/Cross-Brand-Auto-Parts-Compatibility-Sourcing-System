import { NextResponse } from 'next/server';
import { withTransaction } from '@/lib/db';
import { query } from '@/lib/db';
import { requireRole } from '@/lib/auth';
import { embed, toPgVector, buildPartText } from '@/lib/embed';
import { bad, dbError, toInt } from '@/lib/http';

// Add a catalog part: the description is embedded so it becomes instantly findable by meaning.
export async function POST(req) {
  const { session, error } = await requireRole('staff');
  if (error) return error;
  try {
    const b = await req.json();
    const s = (v) => (typeof v === 'string' ? v.trim() : '');
    const categoryId = toInt(b.categoryId), price = Number(b.price), qty = toInt(b.quantity), thr = toInt(b.reorderThreshold ?? 5);
    const vehicleIds = Array.isArray(b.vehicleIds) ? b.vehicleIds.map(toInt) : [];
    if (!s(b.brand) || !s(b.partNumber) || !s(b.name) || !s(b.description)) return bad('Brand, part number, name and description are required');
    if ([categoryId, qty, thr].some(Number.isNaN) || !(price > 0)) return bad('Category, positive price and quantity are required');
    if (!vehicleIds.length || vehicleIds.some(Number.isNaN)) return bad('Select at least one compatible vehicle');
    const amp = b.amperage ? toInt(b.amperage) : null;
    if (Number.isNaN(amp)) return bad('Invalid amperage');

    const cat = (await query('SELECT name FROM categories WHERE category_id = $1', [categoryId])).rows[0];
    if (!cat) return bad('Unknown category');
    const veh = (await query('SELECT make, model, year, engine FROM vehicles WHERE vehicle_id = ANY($1)', [vehicleIds])).rows;
    if (veh.length !== new Set(vehicleIds).size) return bad('Unknown vehicle selected');
    const vec = toPgVector(await embed(buildPartText({ brand: s(b.brand), name: s(b.name), description: s(b.description), category: cat.name, vehicles: veh })));

    const partId = await withTransaction(async (c) => {
      const p = (await c.query(
        `INSERT INTO parts(supplier_id, category_id, brand, part_number, name, description, specs, embedding)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8::vector) RETURNING part_id`,
        [session.supplierId, categoryId, s(b.brand), s(b.partNumber), s(b.name), s(b.description), amp ? { amperage: amp } : {}, vec])).rows[0].part_id;
      for (const vid of new Set(vehicleIds)) await c.query('INSERT INTO part_compatibility(part_id, vehicle_id) VALUES ($1,$2)', [p, vid]);
      await c.query('INSERT INTO inventory(part_id, quantity, reorder_threshold) VALUES ($1,$2,$3)', [p, qty, thr]);
      await c.query('INSERT INTO price_tiers(part_id, min_qty, unit_price) VALUES ($1, 1, $2)', [p, price]);
      return p;
    });
    return NextResponse.json({ partId }, { status: 201 });
  } catch (e) { return dbError(e); }
}
