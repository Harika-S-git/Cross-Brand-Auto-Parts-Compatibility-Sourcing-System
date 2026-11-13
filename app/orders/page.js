'use client';
import { useEffect, useState } from 'react';
import Nav from '@/components/Nav';
import { useUser, inr } from '@/lib/session-client';

export default function Orders() {
  const user = useUser('buyer');
  const [orders, setOrders] = useState(null);
  useEffect(() => { if (user) fetch('/api/orders').then((r) => r.json()).then((d) => setOrders(d.orders || [])).catch(() => setOrders([])); }, [user]);
  if (!user) return null;
  return (<><Nav user={user} /><div className="wrap"><h1>My orders</h1>
    {!orders ? <p>Loading…</p> : orders.length === 0 ? <p className="muted">No orders yet.</p> : orders.map((o) => (
      <div className="card" key={o.order_id}>
        <div className="row"><b>Order #{o.order_id}</b><span className="chip">{o.status}</span><span className="muted small">{new Date(o.created_at).toLocaleString()}</span><span style={{ marginLeft: 'auto' }}><b>{inr(o.total_amount)}</b></span></div>
        <div className="tw"><table><thead><tr><th>Part</th><th>Supplier</th><th>Qty</th><th>Unit price</th></tr></thead>
          <tbody>{o.items.map((i) => <tr key={i.part_id}><td><b>{i.brand}</b> {i.part_number}<br /><span className="small muted">{i.name}</span></td><td>{i.supplier}</td><td>{i.quantity}</td><td>{inr(i.unit_price)}</td></tr>)}</tbody></table></div>
      </div>))}
  </div></>);
}
