import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { query } from '@/lib/db';
import { createSession } from '@/lib/auth';
import { bad, dbError } from '@/lib/http';

const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10); // equalises timing for unknown emails

export async function POST(req) {
  try {
    const { email, password } = await req.json();
    if (typeof email !== 'string' || typeof password !== 'string') return bad('Email and password are required');
    const { rows } = await query('SELECT * FROM users WHERE email = $1', [email.trim().toLowerCase()]);
    const user = rows[0];
    const ok = await bcrypt.compare(password, user?.password_hash || DUMMY_HASH); // constant-ish time
    if (!user || !ok) return bad('Invalid email or password', 401);
    await createSession(user);
    return NextResponse.json({ user: { name: user.name, role: user.role } });
  } catch (e) { return dbError(e); }
}
