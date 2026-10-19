import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
export async function GET() {
  const s = await getSession();
  return s ? NextResponse.json({ user: { name: s.name, role: s.role, supplierId: s.supplierId } })
           : NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
}
