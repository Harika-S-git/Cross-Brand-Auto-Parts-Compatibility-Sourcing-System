import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { requireRole } from '@/lib/auth';
import { dbError } from '@/lib/http';

// Open low-stock alerts raised by the database trigger for this supplier's parts
export async function GET() {
  const { session, error } = await requireRole('staff');
  if (error) return error;
  try {
    const { rows } = await query(
      `SELECT a.alert_id, a.created_at, a.message, p.part_id, p.brand, p.part_number, p.name, i.quantity, i.reorder_threshold
       FROM stock_alerts a JOIN parts p ON p.part_id = a.part_id JOIN inventory i ON i.part_id = p.part_id
       WHERE p.supplier_id = $1 AND a.resolved = FALSE ORDER BY a.created_at DESC`, [session.supplierId]);
    return NextResponse.json({ alerts: rows });
  } catch (e) { return dbError(e); }
}
