import type { APIRoute } from 'astro';
import { getOpenDrafts, completeDraftOrder } from '~/lib/shopify/admin';
import { getCashfreeOrder } from '~/lib/cashfree';

export const prerender = false;

// Safety net for the "buyer paid but the order never got created" gap (e.g. UPI where
// the customer never returns to the site and the webhook doesn't fire). Scans OPEN
// draft orders, checks each one's Cashfree status, and completes any that were PAID.
// Idempotent — completing an already-completed draft is a no-op. Runs on a Vercel cron
// (see vercel.json) and can also be hit manually.
export const GET: APIRoute = async ({ request }) => {
  // When CRON_SECRET is set, require Vercel's cron Authorization header.
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get('authorization') !== `Bearer ${secret}`) {
    return new Response('unauthorized', { status: 401 });
  }

  const drafts = await getOpenDrafts();
  const recovered: string[] = [];
  const failed: string[] = [];

  for (const d of drafts) {
    if (!d.cfOrderId) continue; // COD / no online payment → nothing to reconcile
    const cf = await getCashfreeOrder(d.cfOrderId);
    if (cf?.orderStatus !== 'PAID') continue; // only recover confirmed-paid orders
    const order = await completeDraftOrder(d.id, false); // paid → real order
    if (order?.orderName ?? order?.name) recovered.push(`${d.name} → ${order?.orderName ?? order?.name}`);
    else failed.push(d.name);
  }

  return new Response(
    JSON.stringify({ ok: true, scanned: drafts.length, recovered, failed }, null, 2),
    { status: 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } },
  );
};
