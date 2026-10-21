import type { APIRoute } from 'astro';
import { requestIsAdmin } from '~/lib/adminAuth';
import { pg, q } from '~/lib/db';
import { storesConfigured, syncOrders } from '~/lib/warehouse/orders';
import { syncBookings } from '~/lib/warehouse/bookings';

export const prerender = false;

// Called once when a founder opens /admin, before the sections load, so orders,
// revenue and bookings are as of now rather than as of last night's cron. Never
// polled. Incremental (only what changed in Shopify since the last sync), then the
// People copy is rebuilt so new buyers show as "ordered".
//
// Throttled: if anyone refreshed in the last 2 minutes, it returns at once — two
// founders opening the dashboard together, or a reload, cost nothing extra.
const MIN_GAP = '2 minutes';

const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex, nofollow' },
  });

export const POST: APIRoute = async ({ request }) => {
  if (!(await requestIsAdmin(request))) return json({ error: 'Not authorised' }, 401);
  if (!pg()) return json({ ok: false, reason: 'DATABASE_URL is not set' }, 503);

  // Claim the slot atomically: only one caller per gap gets a row back.
  const claim = await q<{ key: string }>(
    `INSERT INTO sync_state (key, last_run_at) VALUES ('admin_refresh', now())
     ON CONFLICT (key) DO UPDATE SET last_run_at = now()
       WHERE sync_state.last_run_at < now() - interval '${MIN_GAP}'
     RETURNING key`,
  );
  const at = await q<{ last_run_at: Date }>(`SELECT last_run_at FROM sync_state WHERE key = 'admin_refresh'`);
  const asOf = at?.[0]?.last_run_at?.toISOString() ?? null;
  if (!claim?.length) return json({ ok: true, skipped: true, as_of: asOf });

  const t = Date.now();
  const results = await Promise.all([
    ...storesConfigured().map((s) => syncOrders(s)),
    syncBookings(),
  ]);
  await q('SELECT people_refresh(interval \'0 seconds\')');
  const errors = results.map((r) => (r as { error?: string }).error).filter(Boolean);
  return json({ ok: errors.length === 0, skipped: false, as_of: asOf, ms: Date.now() - t, errors });
};
