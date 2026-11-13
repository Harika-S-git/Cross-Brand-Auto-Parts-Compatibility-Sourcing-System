import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

const COOKIE = 'session';
const secret = () => {
  if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET is not set');
  return new TextEncoder().encode(process.env.JWT_SECRET);
};

export async function createSession(user) {
  const token = await new SignJWT({
    uid: user.user_id, role: user.role, name: user.name, supplierId: user.supplier_id ?? null,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('8h')
    .sign(secret());
  cookies().set(COOKIE, token, {
    httpOnly: true, sameSite: 'lax', secure: process.env.COOKIE_SECURE ? process.env.COOKIE_SECURE === 'true' : process.env.NODE_ENV === 'production', path: '/', maxAge: 8 * 3600,
  });
}

export const destroySession = () => cookies().delete(COOKIE);

export async function getSession() {
  const token = cookies().get(COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret());
    return { userId: payload.uid, role: payload.role, name: payload.name, supplierId: payload.supplierId };
  } catch {
    return null;
  }
}

/** Returns { session } or { error: NextResponse } -- role-based authorisation guard. */
export async function requireRole(role) {
  const session = await getSession();
  if (!session) return { error: NextResponse.json({ error: 'Not authenticated' }, { status: 401 }) };
  if (role && session.role !== role) return { error: NextResponse.json({ error: 'Forbidden for your role' }, { status: 403 }) };
  return { session };
}
