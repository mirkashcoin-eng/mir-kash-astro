import type { APIRoute } from 'astro';
import { getAbandonedDrafts } from '~/lib/shopify/admin';
import { sendTemplate, once, whatsappConfigured } from '~/lib/whatsapp';

export const prerender = false;

// Abandoned-cart WhatsApp recovery — the ONLY order-messaging job that lives in this app.
// Order confirmed / shipped / cancelled / refund are all handled by the separate Supabase
// `shopify-webhook` service (driven by Shopify's own webhooks). We must NOT send those from
// here — doing so would double-message the customer. This cron only nudges opted-in
// abandoned payment-drafts, which that service doesn't cover.
//
// Read-only + best-effort + de-duplicated (once per draft). Runs on a Vercel cron
// (see vercel.json); can be hit manually with the CRON_SECRET bearer.

const HOUR = 3600e3;
const RECOVER_MIN = 2 * HOUR;         // give an abandoner time to come back on their own
const RECOVER_MAX = 7 * 24 * HOUR;    // …but don't nag weeks later

const firstName = (name: string | null): string => (name || 'there').trim().split(/\s+/)[0] || 'there';
const ageOf = (iso: string | null): number => (iso ? Date.now() - new Date(iso).getTime() : Infinity);

const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj, null, 2), {
    status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

export const GET: APIRoute = async ({ request, url }) => {
  // Read-only health check: reports config + how many would send, WITHOUT sending.
  const dry = url.searchParams.get('dry') === '1';

  const secret = process.env.CRON_SECRET;
  if (!dry && secret && request.headers.get('authorization') !== `Bearer ${secret}`) {
    return new Response('unauthorized', { status: 401 });
  }
  if (!whatsappConfigured()) return json({ ok: false, configured: false, reason: 'WhatsApp not configured' });

  const abandoned = await getAbandonedDrafts();

  const recoverable = (d: (typeof abandoned)[number]): boolean =>
    (d.detail?.tags ?? []).includes('wa-optin') && Boolean(d.phone) &&
    ageOf(d.createdAt) >= RECOVER_MIN && ageOf(d.createdAt) <= RECOVER_MAX;

  if (dry) {
    return json({ ok: true, dry: true, configured: true, would: { recovered: abandoned.filter(recoverable).length } });
  }

  const sent = { recovered: [] as string[] };

  // Cart recovery — opted-in abandoned payment-drafts, aged 2h–7d.
  for (const d of abandoned) {
    if (!recoverable(d)) continue;
    const ok = await once(`recover:${d.id}`, () =>
      sendTemplate(d.phone!, 'cart_reminder', [firstName(d.customer)]));
    if (ok) sent.recovered.push(d.name);
  }

  return json({ ok: true, ...sent });
};
