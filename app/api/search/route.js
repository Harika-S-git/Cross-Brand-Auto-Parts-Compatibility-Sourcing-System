import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { requireRole } from '@/lib/auth';
import { embed, toPgVector } from '@/lib/embed';
import { parseQuery } from '@/lib/queryParser';
import { bad, dbError, toInt } from '@/lib/http';

/**
 * GET /api/search?q=...&mode=semantic|keyword&vehicleId=
 * semantic: embed query -> rank_matches() (pgvector cosine ANN + price/stock re-rank)
 * keyword : PostgreSQL full-text search (kept for comparison; misses differently-worded parts)
 */
export async function GET(req) {
  const { error } = await requireRole();
  if (error) return error;
  try {
    const sp = new URL(req.url).searchParams;
    const q = (sp.get('q') || '').trim();
    const mode = sp.get('mode') === 'keyword' ? 'keyword' : 'semantic';
    if (q.length < 2 || q.length > 200) return bad('Query must be 2-200 characters');

    const vehicles = (await query('SELECT * FROM vehicles')).rows;
    const parsed = parseQuery(q, vehicles);
    const vParam = toInt(sp.get('vehicleId'));
    const vehicleIds = !Number.isNaN(vParam) ? [vParam] : parsed.vehicleIds.length ? parsed.vehicleIds : null;
    const minAmp = parsed.minAmp;

    let rows;
    if (mode === 'semantic') {
      const vec = toPgVector(await embed(q));
      const minSim = Number(process.env.MIN_SIMILARITY ?? 0.3);
      rows = (await query('SELECT * FROM rank_matches($1::vector, $2::int[], $3::int, $4::numeric, 15)', [vec, vehicleIds, minAmp, minSim])).rows;
    } else {
      rows = (await query(
        `SELECT p.part_id, s.supplier_id, s.name AS supplier_name, s.lead_time_days, p.brand, p.part_number, p.name, p.description,
                c.name AS category, p.specs, ts_rank(p.search_tsv, websearch_to_tsquery('english', $1)) AS similarity,
                get_unit_price(p.part_id, 1) AS unit_price, i.quantity AS stock, ts_rank(p.search_tsv, websearch_to_tsquery('english', $1)) AS score
         FROM parts p JOIN suppliers s ON s.supplier_id = p.supplier_id JOIN categories c ON c.category_id = p.category_id
         JOIN inventory i ON i.part_id = p.part_id
         WHERE p.search_tsv @@ websearch_to_tsquery('english', $1)
           AND ($2::int[] IS NULL OR EXISTS (SELECT 1 FROM part_compatibility pc WHERE pc.part_id = p.part_id AND pc.vehicle_id = ANY($2::int[])))
           AND ($3::int IS NULL OR (p.specs->>'amperage')::int >= $3)
         ORDER BY score DESC LIMIT 15`, [q, vehicleIds, minAmp])).rows;
    }

    const ids = rows.map((r) => r.part_id);
    const tiers = ids.length ? (await query(
      `SELECT part_id, json_agg(json_build_object('min_qty', min_qty, 'unit_price', unit_price) ORDER BY min_qty) AS tiers
       FROM price_tiers WHERE part_id = ANY($1) GROUP BY part_id`, [ids])).rows : [];
    const fits = ids.length ? (await query(
      `SELECT pc.part_id, string_agg(v.make || ' ' || v.model || ' ' || v.year, ', ' ORDER BY v.model, v.year) AS fits
       FROM part_compatibility pc JOIN vehicles v ON v.vehicle_id = pc.vehicle_id WHERE pc.part_id = ANY($1) GROUP BY pc.part_id`, [ids])).rows : [];
    const tMap = Object.fromEntries(tiers.map((t) => [t.part_id, t.tiers]));
    const fMap = Object.fromEntries(fits.map((f) => [f.part_id, f.fits]));

    return NextResponse.json({
      mode,
      interpreted: { year: parsed.year, minAmp, vehicles: (vehicleIds ? vehicles.filter((v) => vehicleIds.includes(v.vehicle_id)) : []).map((v) => `${v.make} ${v.model} ${v.year} ${v.engine}`) },
      results: rows.map((r) => ({
        ...r, similarity: Number(r.similarity), score: Number(r.score), unit_price: Number(r.unit_price),
        confidence: mode === 'semantic' ? Math.round(Math.min(1, Math.max(0, Number(r.similarity))) * 100) : null,
        tiers: tMap[r.part_id] || [], fits: fMap[r.part_id] || '',
      })),
    });
  } catch (e) { return dbError(e); }
}
