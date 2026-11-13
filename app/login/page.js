'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

export default function Login() {
  const [f, setF] = useState({ email: '', password: '' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  const submit = async () => {
    if (busy) return;
    setErr('');
    setBusy(true);
    try {
      const r = await fetch('/api/auth/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...f, email: f.email.trim() }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) return setErr(d.error || `Login failed (HTTP ${r.status}). Check the server terminal for details.`);
      router.replace(d.user.role === 'staff' ? '/staff' : '/');
    } catch {
      setErr('Cannot reach the server. Is `npm run dev` still running?');
    } finally {
      setBusy(false);
    }
  };
  const onEnter = (e) => e.key === 'Enter' && submit();
  return (
    <div className="center card">
      <h1>Sign in</h1>
      <label>Email<input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} onKeyDown={onEnter} /></label>
      <label>Password<input type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} onKeyDown={onEnter} /></label>
      {err && <p className="err">{err}</p>}
      <button onClick={submit} disabled={busy}>{busy ? 'Signing in…' : 'Login'}</button>
      <p className="small muted">New mechanic / buyer? <Link href="/register">Create an account</Link></p>
    </div>
  );
}
