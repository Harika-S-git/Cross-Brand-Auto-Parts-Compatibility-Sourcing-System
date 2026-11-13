'use client';
import { useCallback, useEffect, useState } from 'react';
import Nav from '@/components/Nav';
import { useUser, inr } from '@/lib/session-client';

const post = (url, body, method = 'POST') => fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(async (r) => ({ ok: r.ok, data: await r.json() }));
const tiersToText = (t) => (t || []).map((x) => `${x.min_qty}:${x.unit_price}`).join(', ');
const textToTiers = (s) => s.split(',').map((p) => p.trim()).filter(Boolean).map((p) => { const [m, u] = p.split(':'); return { min_qty: Number(m), unit_price: Number(u) }; });

export default function Staff() {
  const user = useUser('staff');
  const [tab, setTab] = useState('inventory');
  const [parts, setParts] = useState([]); const [alerts, setAlerts] = useState([]); const [rep, setRep] = useState(null);
  const [orders, setOrders] = useState([]); const [meta, setMeta] = useState({ vehicles: [], categories: [] });
  const [edit, setEdit] = useState(null); const [msg, setMsg] = useState(''); const [err, setErr] = useState('');
  const [filter, setFilter] = useState('');

  const load = useCallback(async () => {
    const [a, b, c, d, e] = await Promise.all(['/api/staff/inventory', '/api/staff/alerts', '/api/staff/reports', '/api/orders', '/api/meta'].map((u) => fetch(u).then((r) => r.json()).catch(() => ({ error: 'Cannot reach the server' }))));
    setParts(a.parts || []); setAlerts(b.alerts || []); setRep(c.totals ? c : null); setOrders(d.orders || []);
    setMeta({ vehicles: e.vehicles || [], categories: e.categories || [] });
    const firstErr = [a, b, c, d, e].find((x) => x.error);
    if (firstErr) setErr(firstErr.error);
  }, []);
  useEffect(() => { if (user) load(); }, [user, load]);

  const save = async () => {
    setErr(''); setMsg('');
    const { ok, data } = await post(`/api/staff/inventory/${edit.part_id}`, { quantity: Number(edit.quantity), reorderThreshold: Number(edit.reorder_threshold), tiers: textToTiers(edit.tiersText) }, 'PATCH');
    if (!ok) return setErr(data.error + (data.detail ? ` (${data.detail})` : ''));
    setMsg('Saved'); setEdit(null); load();
  };

  const [np, setNp] = useState({ brand: '', partNumber: '', name: '', description: '', categoryId: '', amperage: '', price: '', quantity: '', reorderThreshold: 5, vehicleIds: [] });
  const addPart = async () => {
    setErr(''); setMsg('');
    const { ok, data } = await post('/api/staff/parts', np);
    if (!ok) return setErr(data.error + (data.detail ? ` (${data.detail})` : ''));
    setMsg(`Part #${data.partId} added and embedded for semantic search`); load();
  };

  if (!user) return null;
  const shown = parts.filter((p) => `${p.brand} ${p.part_number} ${p.name} ${p.category}`.toLowerCase().includes(filter.toLowerCase()));
  return (<><Nav user={user} /><div className="wrap">
    <h1>Distributor dashboard</h1>
    {rep && <div className="stats">
      <div className="card"><div className="muted small">Revenue</div><div className="stat">{inr(rep.totals.revenue)}</div></div>
      <div className="card"><div className="muted small">Orders with my parts</div><div className="stat">{rep.totals.orders}</div></div>
      <div className="card"><div className="muted small">Catalog parts</div><div className="stat">{parts.length}</div></div>
      <div className="card"><div className="muted small">Low-stock parts</div><div className="stat" style={{ color: rep.lowStock ? 'var(--bad)' : 'inherit' }}>{rep.lowStock}</div></div>
    </div>}
    <div className="tabs">{[['inventory', 'Inventory & pricing'], ['alerts', `Low-stock alerts (${alerts.length})`], ['add', 'Add part'], ['reports', 'Reports'], ['orders', 'Orders']].map(([k, l]) =>
      <button key={k} className={tab === k ? 'on' : ''} onClick={() => { setTab(k); setMsg(''); setErr(''); }}>{l}</button>)}</div>
    {err && <p className="err">{err}</p>}{msg && <p className="okmsg">{msg}</p>}

    {tab === 'inventory' && <div className="card">
      <div className="row"><input placeholder="Filter parts…" value={filter} onChange={(e) => setFilter(e.target.value)} /></div>
      <div className="tw"><table><thead><tr><th>Part</th><th>Category</th><th>Stock</th><th>Reorder at</th><th>Price tiers (min qty : ₹)</th><th></th></tr></thead>
        <tbody>{shown.map((p) => edit?.part_id === p.part_id ? (
          <tr key={p.part_id}><td><b>{p.brand}</b> {p.part_number}</td><td>{p.category}</td>
            <td><input type="number" min="0" style={{ width: 80 }} value={edit.quantity} onChange={(e) => setEdit({ ...edit, quantity: e.target.value })} /></td>
            <td><input type="number" min="0" style={{ width: 70 }} value={edit.reorder_threshold} onChange={(e) => setEdit({ ...edit, reorder_threshold: e.target.value })} /></td>
            <td><input style={{ width: 210 }} value={edit.tiersText} onChange={(e) => setEdit({ ...edit, tiersText: e.target.value })} /></td>
            <td><button onClick={save}>Save</button> <button className="sec" onClick={() => setEdit(null)}>Cancel</button></td></tr>
        ) : (
          <tr key={p.part_id}><td><b>{p.brand}</b> {p.part_number}<br /><span className="small muted">{p.name}</span></td><td>{p.category}</td>
            <td>{p.quantity <= p.reorder_threshold ? <span className="chip warn">{p.quantity}</span> : p.quantity}</td><td>{p.reorder_threshold}</td>
            <td>{(p.tiers || []).map((t) => `${t.min_qty}+ → ${inr(t.unit_price)}`).join(' · ')}</td>
            <td><button className="sec" onClick={() => setEdit({ ...p, tiersText: tiersToText(p.tiers) })}>Edit</button></td></tr>))}</tbody></table></div></div>}

    {tab === 'alerts' && <div className="card"><h2>Open alerts <span className="small muted">(raised automatically by a database trigger)</span></h2>
      {alerts.length === 0 ? <p className="muted">No open alerts 🎉</p> : <table><thead><tr><th>Part</th><th>Message</th><th>Raised</th></tr></thead>
        <tbody>{alerts.map((a) => <tr key={a.alert_id}><td><b>{a.brand}</b> {a.part_number}<br /><span className="small muted">{a.name}</span></td><td>{a.message}</td><td>{new Date(a.created_at).toLocaleString()}</td></tr>)}</tbody></table>}
      <p className="small muted">Raise the stock above the reorder level in the Inventory tab and the alert resolves automatically.</p></div>}

    {tab === 'add' && <div className="card"><h2>Add a catalog part</h2>
      <div className="row">
        <input placeholder="Brand" value={np.brand} onChange={(e) => setNp({ ...np, brand: e.target.value })} />
        <input placeholder="Part number" value={np.partNumber} onChange={(e) => setNp({ ...np, partNumber: e.target.value })} />
        <input className="grow" placeholder="Name (as in your catalog)" value={np.name} onChange={(e) => setNp({ ...np, name: e.target.value })} />
        <select value={np.categoryId} onChange={(e) => setNp({ ...np, categoryId: e.target.value })}><option value="">Category…</option>{meta.categories.map((c) => <option key={c.category_id} value={c.category_id}>{c.name}</option>)}</select>
      </div>
      <p><textarea rows="3" placeholder="Description (free text — it will be embedded for semantic search)" value={np.description} onChange={(e) => setNp({ ...np, description: e.target.value })} /></p>
      <div className="row">
        <input type="number" placeholder="Amperage (alternators)" value={np.amperage} onChange={(e) => setNp({ ...np, amperage: e.target.value })} />
        <input type="number" placeholder="Unit price ₹" value={np.price} onChange={(e) => setNp({ ...np, price: e.target.value })} />
        <input type="number" placeholder="Stock qty" value={np.quantity} onChange={(e) => setNp({ ...np, quantity: e.target.value })} />
        <input type="number" placeholder="Reorder at" value={np.reorderThreshold} onChange={(e) => setNp({ ...np, reorderThreshold: e.target.value })} />
      </div>
      <p className="small muted" style={{ marginBottom: 4 }}>Compatible vehicles:</p>
      <div className="row">{meta.vehicles.map((v) => <label key={v.vehicle_id} className="small"><input type="checkbox" checked={np.vehicleIds.includes(v.vehicle_id)}
        onChange={(e) => setNp({ ...np, vehicleIds: e.target.checked ? [...np.vehicleIds, v.vehicle_id] : np.vehicleIds.filter((x) => x !== v.vehicle_id) })} /> {v.make} {v.model} {v.year}</label>)}</div>
      <p><button onClick={addPart}>Add part</button></p></div>}

    {tab === 'reports' && rep && <>
      <div className="card"><h2>Top sellers <span className="small muted">(JOIN · GROUP BY · HAVING · ORDER BY)</span></h2>
        {rep.topSellers.length === 0 ? <p className="muted">No sales yet.</p> : <table><thead><tr><th>Part</th><th>Units</th><th>Orders</th><th>Revenue</th></tr></thead>
          <tbody>{rep.topSellers.map((t) => <tr key={t.part_id}><td><b>{t.brand}</b> {t.part_number}</td><td>{t.units}</td><td>{t.orders}</td><td>{inr(t.revenue)}</td></tr>)}</tbody></table>}</div>
      <div className="card"><h2>Price vs. competing brands for the same vehicles <span className="small muted">(correlated subquery)</span></h2>
        <div className="tw"><table><thead><tr><th>Part</th><th>Category</th><th>My price</th><th>Market avg</th><th>Difference</th></tr></thead>
          <tbody>{rep.pricing.map((p) => { const d = p.market_avg ? ((p.my_price - p.market_avg) / p.market_avg) * 100 : null;
            return <tr key={p.part_id}><td><b>{p.brand}</b> {p.name}</td><td>{p.category}</td><td>{inr(p.my_price)}</td><td>{p.market_avg ? inr(p.market_avg) : '—'}</td>
              <td>{d === null ? '—' : <span className={`chip ${d > 15 ? 'bad' : d < -15 ? 'ok' : ''}`}>{d > 0 ? '+' : ''}{d.toFixed(0)}%</span>}</td></tr>; })}</tbody></table></div></div></>}

    {tab === 'orders' && <div className="card"><h2>Orders containing my parts</h2>
      {orders.length === 0 ? <p className="muted">None yet.</p> : orders.map((o) => <div key={o.order_id} style={{ marginBottom: '.8rem' }}>
        <b>#{o.order_id}</b> · {o.buyer} · {new Date(o.created_at).toLocaleDateString()} · <b>{inr(o.total_amount)}</b>
        <div className="small muted">{o.items.map((i) => `${i.quantity}× ${i.brand} ${i.part_number}`).join(', ')}</div></div>)}</div>}
  </div></>);
}
