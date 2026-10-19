import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { requireRole } from '@/lib/auth';
import { dbError } from '@/lib/http';

export async function GET() {
  const { session, error } = await requireRole('staff');
  if (error) return error;
  try {
    const sid = session.supplierId;
    // JOIN + GROUP BY + HAVING + ORDER BY + aggregates
    const topSellers = (await query(
      `SELECT p.part_id, p.brand, p.part_number, p.name, SUM(oi.quantity) AS units,
              SUM(oi.quantity * oi.unit_price) AS revenue, COUNT(DISTINCT oi.order_id) AS orders
       FROM order_items oi JOIN parts p ON p.part_id = oi.part_id
       WHERE p.supplier_id = $1 GROUP BY p.part_id HAVING SUM(oi.quantity) >= 1
       ORDER BY revenue DESC LIMIT 5`, [sid])).rows;
    // correlated SUBQUERY: own price vs average market price of the same category
    const pricing = (await query(
      `SELECT p.part_id, p.brand, p.name, c.name AS category, get_unit_price(p.part_id, 1) AS my_price,
              ROUND((SELECT AVG(get_unit_price(p2.part_id, 1)) FROM parts p2 WHERE p2.category_id = p.category_id AND p2.part_id <> p.part_id
                       AND (SELECT array_agg(vehicle_id) FROM part_compatibility WHERE part_id = p2.part_id)
                           && (SELECT array_agg(vehicle_id) FROM part_compatibility WHERE part_id = p.part_id)), 2) AS market_avg
       FROM parts p JOIN categories c ON c.category_id = p.category_id
       WHERE p.supplier_id = $1 ORDER BY p.part_id`, [sid])).rows;
    const lowStock = (await query('SELECT COUNT(*) AS n FROM v_low_stock WHERE supplier_id = $1', [sid])).rows[0].n;
    const totals = (await query(
      `SELECT COALESCE(SUM(oi.quantity * oi.unit_price), 0) AS revenue, COUNT(DISTINCT oi.order_id) AS orders
       FROM order_items oi JOIN parts p ON p.part_id = oi.part_id WHERE p.supplier_id = $1`, [sid])).rows[0];
    return NextResponse.json({
      topSellers, lowStock: Number(lowStock), totals,
      pricing: pricing.map((r) => ({ ...r, my_price: Number(r.my_price), market_avg: r.market_avg === null ? null : Number(r.market_avg) })),
    });
  } catch (e) { return dbError(e); }
}
