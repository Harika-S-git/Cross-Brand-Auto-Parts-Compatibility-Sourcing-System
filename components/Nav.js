'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

export default function Nav({ user }) {
  const router = useRouter();
  const logout = async () => { await fetch('/api/auth/logout', { method: 'POST' }); router.replace('/login'); };
  return (
    <div className="nav">
      <b>⚙ AutoParts Sourcing</b>
      {user.role === 'buyer' && (<><Link href="/">Search &amp; Order</Link><Link href="/orders">My Orders</Link></>)}
      {user.role === 'staff' && <Link href="/staff">Distributor Dashboard</Link>}
      <span className="sp" />
      <small>{user.name} · {user.role}</small>
      <a href="#" onClick={(e) => { e.preventDefault(); logout(); }}>Logout</a>
    </div>
  );
}
