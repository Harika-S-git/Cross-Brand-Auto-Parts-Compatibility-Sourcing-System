'use client';
import { useEffect, useState } from 'react';
import Nav from '@/components/Nav';
import { useUser, inr } from '@/lib/session-client';

const EXAMPLES = ['alternator for 2015 Civic, need 90A or higher', 'front brake pads for Corolla', 'iridium spark plugs for Honda City', 'starter motor 2014 civic'];

export default function SearchPage() {
  const user = useUser('buyer');
  const [meta, setMeta] = useState({ vehicles: [], summary: null });
  const [q, setQ] = useState(EXAMPLES[0]);
  const [mode, setMode] = useState('semantic');
  const [vehicleId, setVehicleId] = useState('');
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [cart, setCart] = useState([]);          // [{part, qty}]
  const [msg, setMsg] = useState('');

  useEffect(() => { if (user) fetch('/api/meta').then((r) => r.json()).then((d) => setMeta((m) => ({ ...m, vehicles: d.vehicles || m.vehicles }))).catch(() => {}); }, [user]);
  useEffect(() => {
    if (!user) return;
    fetch(`/api/meta${vehicleId ? `?vehicleId=${vehicleId}` : ''}`).then((r) => r.json()).then((d) => setMeta((m) => ({ ...m, summary: d.summary ?? null }))).catch(() => {});
  }, [vehicleId, user]);

  const search = async (keepMsg = false) => {
    setBusy(true); setErr(''); if (keepMsg !== true) setMsg('');
    try {
      const r = await fetch(`/api/search?q=${encodeURIComponent(q)}&mode=${mode}${vehicleId ? `&vehicleId=${vehicleId}` : ''}`);
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setErr(d.error || `Search failed (HTTP ${r.status})`); setData(null); } else setData(d);
    } catch { setErr('Cannot reach the server. Is `npm run dev` still running?'); setData(null); }
    finally { setBusy(false); }
  };
  const addToCart = (part) => setCart((c) => c.some((x) => x.part.part_id === part.part_id) ? c : [...c, { part, qty: 1 }]);
  const setQty = (id, qty) => setCart((c) => c.map((x) => (x.part.part_id === id ? { ...x, qty: Math.max(1, Math.min(1000, Number(qty) || 1)) } : x)));
  const price = (part, qty) => Number([...part.tiers].reverse().find((t) => t.min_qty <= qty)?.unit_price ?? part.unit_price);
  const total = cart.reduce((s, x) => s + price(x.part, x.qty) * x.qty, 0);

  const order = async () => {
    setErr(''); setMsg('');
    try {
      const r = await fetch('/api/orders', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: cart.map((x) => ({ partId: x.part.part_id, quantity: x.qty })) }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) return setErr(d.error || `Order failed (HTTP ${r.status})`);
      setMsg(`Order #${d.orderId} placed — ${d.lines} line(s), total ${inr(d.total)}`); setCart([]); search(true);
    } catch { setErr('Cannot reach the server. Is `npm run dev` still running?'); }
  };

  if (!user) return null;
  return (<>
    <Nav user={user} />
    <div className="wrap">
      <div className="card">
        <h1>Find compatible parts across all brands</h1>
        <div className="row">
          <input className="grow" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && search()}
            placeholder="e.g. alternator for 2015 Civic, need 90A or higher" />
          <select value={vehicleId} onChange={(e) => setVehicleId(e.target.value)}>
            <option value="">Any vehicle (auto-detect)</option>
            {meta.vehicles.map((v) => <option key={v.vehicle_id} value={v.vehicle_id}>{v.make} {v.model} {v.year} {v.engine}</option>)}
          </select>
          <select value={mode} onChange={(e) => setMode(e.target.value)}>
            <option value="semantic">Semantic (pgvector)</option><option value="keyword">Keyword (full-text)</option>
          </select>
          <button onClick={() => search()} disabled={busy}>{busy ? 'Searching…' : 'Search'}</button>
        </div>
        <p className="small muted" style={{ marginBottom: 0 }}>Try: {EXAMPLES.map((e) => <a key={e} href="#" onClick={(ev) => { ev.preventDefault(); setQ(e); }} style={{ marginRight: '.8rem' }}>“{e}”</a>)}</p>
      </div>

      {meta.summary?.length > 0 && (
        <div className="card"><h2>Compatible-parts summary for the selected vehicle <span className="small muted">(database view)</span></h2>
          <div className="tw"><table><thead><tr><th>Category</th><th>Compatible parts</th><th>Suppliers</th><th>Brands</th><th>Lowest price</th><th>Total stock</th></tr></thead>
            <tbody>{meta.summary.map((s) => <tr key={s.category}><td>{s.category}</td><td>{s.compatible_parts}</td><td>{s.suppliers}</td><td>{s.brands}</td><td>{inr(s.lowest_price)}</td><td>{s.total_stock}</td></tr>)}</tbody></table></div></div>
      )}

      {err && <p className="err">{err}</p>}{msg && <p className="okmsg">{msg}</p>}
      <div className="grid2">
        <div className="card">
          {!data ? <p className="muted">Run a search to see ranked cross-brand matches.</p> : (<>
            <p className="small">
              Understood as: {data.interpreted.vehicles.length ? data.interpreted.vehicles.map((v) => <span className="chip" key={v}>{v}</span>) : <span className="chip">any vehicle</span>}
              {data.interpreted.minAmp && <span className="chip">≥ {data.interpreted.minAmp}A</span>}
              <span className="muted"> · {data.results.length} result(s), {data.mode === 'semantic' ? 'ranked by similarity + price + stock' : 'ranked by text relevance'}</span>
            </p>
            {data.results.length === 0 ? <p className="muted">No matches. {data.mode === 'keyword' && 'Keyword search needs the same words — try Semantic mode.'}</p> :
            <div className="tw"><table>
              <thead><tr><th>{data.mode === 'semantic' ? 'Match' : 'Rank'}</th><th>Part</th><th>Supplier</th><th>Price (tiers)</th><th>Stock</th><th></th></tr></thead>
              <tbody>{data.results.map((r) => (
                <tr key={r.part_id}>
                  <td>{data.mode === 'semantic' ? <>{r.confidence}%<span className="bar"><i style={{ width: `${r.confidence}%` }} /></span></> : r.score.toFixed(3)}</td>
                  <td><b>{r.brand}</b> <span className="muted">{r.part_number}</span><br />{r.name}<br /><span className="small muted">Fits: {r.fits}</span></td>
                  <td>{r.supplier_name}<br /><span className="small muted">{r.lead_time_days}d lead time</span></td>
                  <td><b>{inr(r.unit_price)}</b><br />{r.tiers.slice(1).map((t) => <span className="small muted" key={t.min_qty}>{t.min_qty}+: {inr(t.unit_price)}<br /></span>)}</td>
                  <td>{r.stock === 0 ? <span className="chip bad">Out of stock</span> : r.stock <= 5 ? <span className="chip warn">{r.stock} left</span> : <span className="chip ok">{r.stock}</span>}</td>
                  <td><button className="sec" disabled={r.stock === 0} onClick={() => addToCart(r)}>Add</button></td>
                </tr>))}</tbody></table></div>}
          </>)}
        </div>

        <div className="card">
          <h2>Order cart</h2>
          {cart.length === 0 ? <p className="muted">Add parts from one or several suppliers; they are ordered in one atomic transaction.</p> : (<>
            {cart.map(({ part, qty }) => (
              <div key={part.part_id} style={{ marginBottom: '.7rem' }}>
                <b>{part.brand}</b> {part.part_number}<br /><span className="small muted">{part.supplier_name}</span>
                <div className="row">
                  <input type="number" min="1" max={part.stock} value={qty} style={{ width: 80 }} onChange={(e) => setQty(part.part_id, e.target.value)} />
                  <span>× {inr(price(part, qty))}</span>
                  <button className="sec" onClick={() => setCart(cart.filter((x) => x.part.part_id !== part.part_id))}>✕</button>
                </div>
              </div>))}
            <p><b>Total: {inr(total)}</b> <span className="small muted">({new Set(cart.map((x) => x.part.supplier_id)).size} supplier(s))</span></p>
            <button onClick={order}>Place order</button>
          </>)}
        </div>
      </div>
    </div>
  </>);
}
