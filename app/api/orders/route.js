import { NextResponse } from 'next/server';
import { query, withTransaction } from '@/lib/db';
import { requireRole } from '@/lib/auth';
import { AppError, bad, dbError, toInt } from '@/lib/http';

const ITEMS_SQL = `json_agg(json_build_object('part_id', p.part_id, 'brand', p.brand, 'part_number', p.part_number,
                   'name', p.name, 'supplier', s.name, 'quantity', oi.quantity, 'unit_price', oi.unit_price) ORDER BY oi.order_item_id)`;

// Buyers: own orders. Staff: orders containing parts of THEIR supplier (only those lines).
export async function GET() {
  const { session, error } = await requireRole();
  if (error) return error;
  try {
    const isStaff = session.role === 'staff';
    const { rows } = await query(
      `SELECT o.order_id, o.status, o.created_at, u.name AS buyer, ${ITEMS_SQL} AS items,
              SUM(oi.quantity * oi.unit_price) AS total_amount
       FROM orders o JOIN users u ON u.user_id = o.buyer_id
       JOIN order_items oi ON oi.order_id = o.order_id
       JOIN parts p ON p.part_id = oi.part_id JOIN suppliers s ON s.supplier_id = p.supplier_id
       WHERE ${isStaff ? 'p.supplier_id = $1' : 'o.buyer_id = $1'}
       GROUP BY o.order_id, u.name ORDER BY o.order_id DESC LIMIT 50`,
      [isStaff ? session.supplierId : session.userId]);
    return NextResponse.json({ orders: rows });
  } catch (e) { return dbError(e); }
}

/**
 * Place an order across one or many suppliers -- ONE atomic transaction:
 * row-lock stock (FOR UPDATE, ordered by part_id to avoid deadlocks), check availability,
 * decrement, price by volume tier, insert lines, set total. Any failure => ROLLBACK, nothing changes.
 */
export async function POST(req) {
  const { session, error } = await requireRole('buyer');
  if (error) return error;
  try {
    const body = await req.json();
    if (!Array.isArray(body.items) || body.items.length === 0 || body.items.length > 50) return bad('Cart must contain 1-50 items');
    const merged = new Map();
    for (const it of body.items) {
      const pid = toInt(it.partId), qty = toInt(it.quantity);
      if (Number.isNaN(pid) || Number.isNaN(qty) || qty < 1 || qty > 1000) return bad('Invalid item or quantity');
      merged.set(pid, (merged.get(pid) || 0) + qty);
    }
    const lines = [...merged.entries()].sort((a, b) => a[0] - b[0]);

    const result = await withTransaction(async (c) => {
      const order = (await c.query('INSERT INTO orders(buyer_id) VALUES ($1) RETURNING order_id', [session.userId])).rows[0];
      let total = 0;
      for (const [pid, qty] of lines) {
        const inv = (await c.query(
          `SELECT i.quantity, p.brand, p.part_number FROM inventory i JOIN parts p ON p.part_id = i.part_id
           WHERE i.part_id = $1 FOR UPDATE OF i`, [pid])).rows[0];
        if (!inv) throw new AppError(`Part ${pid} not found`, 404);
        if (inv.quantity < qty) throw new AppError(`Insufficient stock for ${inv.brand} ${inv.part_number}: requested ${qty}, available ${inv.quantity}`, 409);
        const price = (await c.query('SELECT get_unit_price($1, $2) AS p', [pid, qty])).rows[0].p;
        if (price === null) throw new AppError(`No price configured for ${inv.brand} ${inv.part_number}`, 409);
        await c.query('UPDATE inventory SET quantity = quantity - $2 WHERE part_id = $1', [pid, qty]); // fires low-stock trigger
        await c.query('INSERT INTO order_items(order_id, part_id, quantity, unit_price) VALUES ($1,$2,$3,$4)', [order.order_id, pid, qty, price]);
        total += Number(price) * qty;
      }
      await c.query('UPDATE orders SET total_amount = $1 WHERE order_id = $2', [total, order.order_id]);
      return { orderId: order.order_id, total, lines: lines.length };
    });
    return NextResponse.json(result, { status: 201 });
  } catch (e) { return dbError(e); }
}
