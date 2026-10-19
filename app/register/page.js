'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

export default function Register() {
  const [f, setF] = useState({ name: '', email: '', password: '' });
  const [err, setErr] = useState('');
  const router = useRouter();
  const submit = async () => {
    setErr('');
    const r = await fetch('/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(f) });
    const d = await r.json();
    if (!r.ok) return setErr(d.error);
    router.replace('/');
  };
  return (
    <div className="center card">
      <h1>Create buyer account</h1>
      <label>Name / garage<input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
      <label>Email<input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></label>
      <label>Password (min 8 chars)<input type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></label>
      {err && <p className="err">{err}</p>}
      <button onClick={submit}>Register</button>
      <p className="small muted">Already registered? <Link href="/login">Sign in</Link></p>
    </div>
  );
}
