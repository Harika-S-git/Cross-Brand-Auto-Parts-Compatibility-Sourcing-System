import { NextResponse } from 'next/server';
import { query, withTransaction } from '@/lib/db';
import { requireRole } from '@/lib/auth';
import { AppError, bad, dbError, toInt } from '@/lib/http';

// Staff may only change parts that belong to their own supplier (row-level authorisation).
export async function PATCH(req, { params }) {
  const { session, error } = await requireRole('staff');
  if (error) return error;
  try {
    const pid = toInt(params.partId);
    if (Number.isNaN(pid)) return bad('Invalid part id');
    const own = await query('SELECT 1 FROM parts WHERE part_id = $1 AND supplier_id = $2', [pid, session.supplierId]);
    if (!own.rowCount) return bad('Part not found for your supplier', 403);

    const { quantity, reorderThreshold, tiers } = await req.json();
    if (tiers !== undefined) {
      if (!Array.isArray(tiers) || !tiers.some((t) => Number(t.min_qty) === 1)) return bad('Provide price tiers including one starting at quantity 1');
      if (tiers.some((t) => !(Number(t.unit_price) > 0) || !Number.isInteger(Number(t.min_qty)) || Number(t.min_qty) < 1)) return bad('Invalid price tier');
    }
    await withTransaction(async (c) => {
      if (quantity !== undefined || reorderThreshold !== undefined) {
        await c.query(`UPDATE inventory SET quantity = COALESCE($2, quantity), reorder_threshold = COALESCE($3, reorder_threshold) WHERE part_id = $1`,
          [pid, quantity ?? null, reorderThreshold ?? null]);
      }
      if (tiers !== undefined) {
        await c.query('DELETE FROM price_tiers WHERE part_id = $1', [pid]);
        for (const t of tiers) await c.query('INSERT INTO price_tiers(part_id, min_qty, unit_price) VALUES ($1,$2,$3)', [pid, t.min_qty, t.unit_price]);
      }
    });
    return NextResponse.json({ ok: true });
  } catch (e) { return dbError(e); }
}
