'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

export default function Login() {
  const [f, setF] = useState({ email: '', password: '' });
  const [err, setErr] = useState('');
  const router = useRouter();
  const submit = async () => {
    setErr('');
    const r = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(f) });
    const d = await r.json();
    if (!r.ok) return setErr(d.error);
    router.replace(d.user.role === 'staff' ? '/staff' : '/');
  };
  return (
    <div className="center card">
      <h1>Sign in</h1>
      <label>Email<input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></label>
      <label>Password<input type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })}
        onKeyDown={(e) => e.key === 'Enter' && submit()} /></label>
      {err && <p className="err">{err}</p>}
      <button onClick={submit}>Login</button>
      <p className="small muted">New mechanic / buyer? <Link href="/register">Create an account</Link></p>
    </div>
  );
}
