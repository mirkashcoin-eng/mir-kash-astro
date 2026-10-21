import type { APIRoute } from 'astro';
import { q } from '~/lib/db';

export const prerender = false;

// Keeps the People table's materialized copy (mv_people, db/migrations/004_people.sql)
// fresh in the background, so no founder's page load ever pays for the rebuild.
// people_refresh() is a no-op when the copy is under 5 minutes old and takes an
// advisory lock, so overlapping runs never rebuild twice. Runs on a Vercel cron
// (see vercel.json); can be hit manually with the CRON_SECRET bearer.

const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj, null, 2), {
    status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

export const GET: APIRoute = async ({ request }) => {
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get('authorization') !== `Bearer ${secret}`) {
    return new Response('unauthorized', { status: 401 });
  }
  const t = Date.now();
  const rows = await q('SELECT people_refresh() AS refreshed');
  if (!rows) return json({ ok: false, error: 'database unavailable or refresh failed' }, 500);
  return json({ ok: true, refreshed: rows[0]?.refreshed ?? null, ms: Date.now() - t });
};
