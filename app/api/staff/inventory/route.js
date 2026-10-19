import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { requireRole } from '@/lib/auth';
import { dbError } from '@/lib/http';

export async function GET() {
  const { session, error } = await requireRole('staff');
  if (error) return error;
  try {
    const { rows } = await query(
      `SELECT p.part_id, p.brand, p.part_number, p.name, c.name AS category, i.quantity, i.reorder_threshold,
              (SELECT json_agg(json_build_object('min_qty', t.min_qty, 'unit_price', t.unit_price) ORDER BY t.min_qty)
               FROM price_tiers t WHERE t.part_id = p.part_id) AS tiers
       FROM parts p JOIN categories c ON c.category_id = p.category_id JOIN inventory i ON i.part_id = p.part_id
       WHERE p.supplier_id = $1 ORDER BY p.part_id`, [session.supplierId]);
    return NextResponse.json({ parts: rows });
  } catch (e) { return dbError(e); }
}
