import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { query } from '@/lib/db';
import { createSession } from '@/lib/auth';
import { bad, dbError } from '@/lib/http';

// Self-registration creates BUYER accounts only. Staff accounts are provisioned by the distributor.
export async function POST(req) {
  try {
    const { name, email, password } = await req.json();
    if (typeof name !== 'string' || name.trim().length < 2) return bad('Name must be at least 2 characters');
    if (typeof email !== 'string' || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return bad('Enter a valid email');
    if (typeof password !== 'string' || password.length < 8) return bad('Password must be at least 8 characters');
    const hash = await bcrypt.hash(password, 10);
    const { rows } = await query(
      `INSERT INTO users(name,email,password_hash,role) VALUES ($1,$2,$3,'buyer') RETURNING user_id, name, role, supplier_id`,
      [name.trim(), email.trim().toLowerCase(), hash]);
    await createSession(rows[0]);
    return NextResponse.json({ user: { name: rows[0].name, role: rows[0].role } }, { status: 201 });
  } catch (e) { return dbError(e); }
}
