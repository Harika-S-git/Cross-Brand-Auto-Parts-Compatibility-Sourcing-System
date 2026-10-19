import { NextResponse } from 'next/server';

export const bad = (msg, status = 400) => NextResponse.json({ error: msg }, { status });

/** Translate PostgreSQL constraint errors into friendly 4xx responses. */
export function dbError(err) {
  const map = { '23505': [409, 'Duplicate value violates a unique constraint'],
                '23503': [409, 'Referenced record does not exist / is still in use'],
                '23514': [400, 'Value rejected by a database CHECK constraint'],
                '23502': [400, 'A required value is missing'],
                '22P02': [400, 'Invalid value format'] };
  const hit = map[err.code];
  if (hit) return NextResponse.json({ error: hit[1], detail: err.constraint || undefined }, { status: hit[0] });
  console.error(err);
  return NextResponse.json({ error: err.userMessage || 'Internal server error' }, { status: err.status || 500 });
}

export class AppError extends Error {
  constructor(message, status = 400) { super(message); this.userMessage = message; this.status = status; }
}

export const toInt = (v) => (Number.isInteger(Number(v)) && v !== '' && v !== null ? Number(v) : NaN);
