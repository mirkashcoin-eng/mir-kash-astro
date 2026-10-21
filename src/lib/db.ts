// Postgres on Neon — the analytics store (events, sessions, visitors, people, orders).
// Uses node-postgres over the POOLED connection string (DATABASE_URL, host ends in
// -pooler), as Neon recommends for Vercel functions. attachDatabasePool lets Vercel
// Fluid compute close idle clients before a function instance is suspended, so
// connections never leak. Schema changes go through scripts/migrate.mjs on the
// DIRECT string (DATABASE_URL_UNPOOLED), never through this pool.
//
// Degrades to null when DATABASE_URL isn't set, like adminDb() — analytics must
// never take the shop down.
import { Pool, type PoolClient, type QueryResultRow } from 'pg';
import { attachDatabasePool } from '@vercel/functions';

function env(k: string): string {
  if (typeof process !== 'undefined' && process.env && process.env[k]) return process.env[k] as string;
  const m = import.meta.env as Record<string, string | undefined>;
  return m[k] ?? '';
}

let _pool: Pool | null | undefined;

export function pg(): Pool | null {
  if (_pool !== undefined) return _pool;
  const url = env('DATABASE_URL').trim();
  if (!url) { _pool = null; return null; }
  _pool = new Pool({
    connectionString: url,
    max: 5,                       // per function instance; the Neon pooler fans in
    idleTimeoutMillis: 5_000,
    connectionTimeoutMillis: 5_000,
  });
  _pool.on('error', (e) => console.error('[db] idle client error:', e));
  try { attachDatabasePool(_pool); } catch { /* not on Vercel (local dev) — fine */ }
  return _pool;
}

// One query. Returns rows, or null when the database is unavailable or the query
// failed (logged). Callers decide whether null means "show nothing" or "error".
export async function q<T extends QueryResultRow = QueryResultRow>(
  sql: string,
  params: unknown[] = [],
): Promise<T[] | null> {
  const pool = pg();
  if (!pool) return null;
  try {
    const r = await pool.query<T>(sql, params);
    return r.rows;
  } catch (e) {
    console.error('[db] query failed:', e);
    return null;
  }
}

// Run `fn` inside one transaction. Throws on failure (after rolling back), so the
// caller can count it; returns null only when the database isn't configured.
export async function tx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T | null> {
  const pool = pg();
  if (!pool) return null;
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const out = await fn(c);
    await c.query('COMMIT');
    return out;
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}
