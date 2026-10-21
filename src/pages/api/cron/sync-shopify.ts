import type { APIRoute } from 'astro';
import { pg } from '~/lib/db';
import { storesConfigured, syncOrders } from '~/lib/warehouse/orders';
import { syncBookings } from '~/lib/warehouse/bookings';

export const prerender = false;

// Keeps Neon's `orders`, `returns` and `bookings` an exact mirror of Shopify (India +
// Global). Incremental by default: only what changed since the last run. `?full=1`
// re-reads everything and drops orders Shopify no longer has — the one-time backfill,
// and a monthly safety net. Runs on a Vercel cron and can be hit by hand:
//   curl -H "Authorization: Bearer $CRON_SECRET" https://www.mirkash.com/api/cron/sync-shopify?full=1
// The response carries Shopify's own counts next to ours, so parity is visible.
export const GET: APIRoute = async ({ request, url }) => {
  // When CRON_SECRET is set, require Vercel's cron Authorization header.
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get('authorization') !== `Bearer ${secret}`) {
    return new Response('unauthorized', { status: 401 });
  }
  const json = (obj: unknown, status = 200) => new Response(JSON.stringify(obj, null, 2), {
    status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
  if (!pg()) return json({ ok: false, reason: 'DATABASE_URL is not set' }, 503);

  const full = url.searchParams.get('full') === '1';
  const stores = storesConfigured();
  const orders = [];
  for (const s of stores) orders.push(await syncOrders(s, { full }));
  const bookings = await syncBookings({ full });

  const ok = orders.every((o) => !o.error) && !bookings.error;
  return json({
    ok,
    full,
    skipped: stores.includes('global') ? [] : ['global (SHOPIFY_GLOBAL_ADMIN_DOMAIN / _TOKEN not set)'],
    orders,
    bookings,
  }, ok ? 200 : 500);
};
