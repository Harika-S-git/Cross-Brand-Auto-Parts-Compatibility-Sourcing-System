import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { requireRole } from '@/lib/auth';
import { dbError, toInt } from '@/lib/http';

// vehicles + categories for dropdowns; ?vehicleId=N adds the compatible-parts summary VIEW
export async function GET(req) {
  const { error } = await requireRole();
  if (error) return error;
  try {
    const vehicles = (await query('SELECT * FROM vehicles ORDER BY make, model, year')).rows;
    const categories = (await query('SELECT * FROM categories ORDER BY name')).rows;
    const vid = toInt(new URL(req.url).searchParams.get('vehicleId'));
    const summary = Number.isNaN(vid) ? null
      : (await query('SELECT category, compatible_parts, suppliers, brands, lowest_price, total_stock FROM v_vehicle_compatible_parts WHERE vehicle_id=$1 ORDER BY category', [vid])).rows;
    return NextResponse.json({ vehicles, categories, summary });
  } catch (e) { return dbError(e); }
}
