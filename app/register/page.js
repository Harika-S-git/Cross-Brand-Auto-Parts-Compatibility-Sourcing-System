'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

export default function Register() {
  const [f, setF] = useState({ name: '', email: '', password: '' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  const submit = async () => {
    if (busy) return;
    setErr('');
    setBusy(true);
    try {
      const r = await fetch('/api/auth/register', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...f, name: f.name.trim(), email: f.email.trim() }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) return setErr(d.error || `Registration failed (HTTP ${r.status}). Check the server terminal for details.`);
      router.replace('/');
    } catch {
      setErr('Cannot reach the server. Is `npm run dev` still running?');
    } finally {
      setBusy(false);
    }
  };
  const onEnter = (e) => e.key === 'Enter' && submit();
  return (
    <div className="center card">
      <h1>Create buyer account</h1>
      <label>Name / garage<input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} onKeyDown={onEnter} /></label>
      <label>Email<input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} onKeyDown={onEnter} /></label>
      <label>Password (min 8 chars)<input type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} onKeyDown={onEnter} /></label>
      {err && <p className="err">{err}</p>}
      <button onClick={submit} disabled={busy}>{busy ? 'Creating…' : 'Register'}</button>
      <p className="small muted">Already registered? <Link href="/login">Sign in</Link></p>
    </div>
  );
}
