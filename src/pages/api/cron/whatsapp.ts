import type { APIRoute } from 'astro';
import { getRecentOrders, getAbandonedDrafts } from '~/lib/shopify/admin';

type Money = { amount: string; currencyCode: string };
import { sendTemplate, once, whatsappConfigured } from '~/lib/whatsapp';

export const prerender = false;

// WhatsApp notifications, driven entirely off order/draft state — no changes to the
// checkout or payment code, so a messaging outage can never affect a sale. Every send
// is de-duplicated (once per order/draft), and only ever to customers who ticked the
// "order updates on WhatsApp" opt-in. Runs on a Vercel cron (see vercel.json); can be
// hit manually with the CRON_SECRET bearer.
//
// Three passes:
//   1. Order confirmed  — opted-in orders created recently.
//   2. Order shipped    — opted-in orders now fulfilled.
//   3. Cart recovery    — opted-in abandoned payment-drafts, 2h–7d old.
// Timestamp windows keep the first run after deploy from back-messaging old orders.

const HOUR = 3600e3;
const RECENT = 26 * HOUR;             // confirm/ship: only events from ~the last day
const RECOVER_MIN = 2 * HOUR;         // give an abandoner time to come back on their own
const RECOVER_MAX = 7 * 24 * HOUR;    // …but don't nag weeks later
const SHOP_URL = 'https://mirkash.com/shop';

const money = (m: Money | null): string => {
  if (!m) return '';
  const n = Math.round(Number(m.amount) || 0);
  try { return new Intl.NumberFormat('en-IN', { style: 'currency', currency: m.currencyCode || 'INR', maximumFractionDigits: 0 }).format(n); }
  catch { return `${m.currencyCode || 'INR'} ${n}`; }
};
const firstName = (name: string | null): string => (name || 'there').trim().split(/\s+/)[0] || 'there';
const ageOf = (iso: string | null): number => (iso ? Date.now() - new Date(iso).getTime() : Infinity);

const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj, null, 2), {
    status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

export const GET: APIRoute = async ({ request }) => {
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get('authorization') !== `Bearer ${secret}`) {
    return new Response('unauthorized', { status: 401 });
  }
  if (!whatsappConfigured()) return json({ ok: false, reason: 'WhatsApp not configured' });

  const [orders, abandoned] = await Promise.all([getRecentOrders(), getAbandonedDrafts()]);
  const sent = { confirmed: [] as string[], shipped: [] as string[], recovered: [] as string[] };

  // 1) Order confirmed — opted-in, created in the recent window.
  for (const o of orders) {
    const phone = o.phone;
    if (o.cancelled || !o.waOptin || !phone) continue;
    if (ageOf(o.createdAt) > RECENT) continue;
    const ok = await once(`confirm:${o.name}`, () =>
      sendTemplate(phone, 'order_confirmed', [firstName(o.customer), o.name, money(o.total)]));
    if (ok) sent.confirmed.push(o.name);
  }

  // 2) Order shipped — opted-in, fulfilled in the recent window.
  for (const o of orders) {
    const phone = o.phone;
    if (o.cancelled || !o.waOptin || !phone) continue;
    if (String(o.fulfillment).toUpperCase() !== 'FULFILLED') continue;
    if (ageOf(o.fulfilledAt) > RECENT) continue;
    const ok = await once(`ship:${o.name}`, () =>
      sendTemplate(phone, 'order_shipped', [firstName(o.customer), o.name]));
    if (ok) sent.shipped.push(o.name);
  }

  // 3) Cart recovery — opted-in abandoned payment-drafts, aged 2h–7d.
  for (const d of abandoned) {
    const phone = d.phone;
    const optedIn = (d.detail?.tags ?? []).includes('wa-optin');
    if (!optedIn || !phone) continue;
    const age = ageOf(d.createdAt);
    if (age < RECOVER_MIN || age > RECOVER_MAX) continue;
    const ok = await once(`recover:${d.id}`, () =>
      sendTemplate(phone, 'cart_reminder', [firstName(d.customer), SHOP_URL]));
    if (ok) sent.recovered.push(d.name);
  }

  return json({ ok: true, ...sent });
};
