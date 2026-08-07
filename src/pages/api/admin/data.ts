import type { APIRoute } from 'astro';
import { requestIsAdmin } from '~/lib/adminAuth';
import { getDemoBookings, getAbandonedCheckouts, getAbandonedDrafts, getRecentOrders, type AbandonedCheckout } from '~/lib/shopify/admin';
import { getFunnel, getProductStats } from '~/lib/analytics';
import { getPeople, personKey, type Person } from '~/lib/leads';
import { getAffiliateSummary } from '~/lib/clicks';

export const prerender = false;

const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'private, no-store',
      'X-Robots-Tag': 'noindex, nofollow',
    },
  });

// A person plus whatever Shopify knows about them. Shopify is authoritative for the
// two money stages — an open payment draft (abandoned) and a real order.
interface PersonRow extends Person {
  abandoned: AbandonedCheckout | null;
  ordered: boolean;
  orderTotal: number;
  orderCount: number;          // live orders — >1 means a repeat buyer
  lifetimeValue: number;       // summed across those orders
  daysToPurchase: number | null; // first seen → first order, in days
}

// Whole days between two instants; null unless both are usable and ordered.
function daysBetween(from: string | null, to: string | null): number | null {
  if (!from || !to) return null;
  const a = new Date(from).getTime();
  const b = new Date(to).getTime();
  if (!isFinite(a) || !isFinite(b) || b < a) return null;
  return Math.floor((b - a) / 864e5);
}

// Founders-only data feed for /admin. Auth = Firebase ID token (Bearer) whose email
// must be in the ADMIN_EMAILS allowlist, or the shared passcode. India Admin data only.
export const GET: APIRoute = async ({ request }) => {
  if (!(await requestIsAdmin(request))) return json({ error: 'Not authorised' }, 401);

  const [demos, nativeAbandoned, draftAbandoned, orders, funnel, people, products] = await Promise.all([
    getDemoBookings(),
    getAbandonedCheckouts(), // Global store — Shopify-hosted checkout
    getAbandonedDrafts(),    // India store — open Cashfree payment drafts
    getRecentOrders(),
    getFunnel(30),           // first-party visitor funnel (anonymous)
    getPeople(500),          // durable people (phone-keyed), with their journey data
    getProductStats(20),     // most-viewed products
  ]);
  const abandoned = [...draftAbandoned, ...nativeAbandoned].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );

  // Needs `orders` (Shopify is authoritative for revenue), so it runs after the batch.
  const affiliates = await getAffiliateSummary(orders);

  // Overlay Shopify state onto each person, matched on the same phone key the People
  // collection is keyed by (falling back to email, which the global store fills in).
  const abandonedBy = new Map<string, (typeof abandoned)[number]>();
  for (const a of abandoned) {
    const k = personKey(a.phone) || (a.email || '').toLowerCase();
    if (k && !abandonedBy.has(k)) abandonedBy.set(k, a);
  }
  const orderBy = new Map<string, (typeof orders)[number]>();
  // Every live order per person, so we can tell a repeat buyer from a first-timer
  // and date the FIRST purchase (orders arrive newest-first).
  const ordersFor = new Map<string, (typeof orders)[number][]>();
  for (const o of orders) {
    if (o.cancelled) continue;
    const k = personKey(o.phone) || (o.email || '').toLowerCase();
    if (!k) continue;
    if (!orderBy.has(k)) orderBy.set(k, o);
    const list = ordersFor.get(k) ?? [];
    list.push(o);
    ordersFor.set(k, list);
  }

  const rows: PersonRow[] = (people ?? []).map((p) => {
    const byEmail = (p.email || '').toLowerCase();
    const a = abandonedBy.get(p.id) || (byEmail ? abandonedBy.get(byEmail) : undefined) || null;
    const o = orderBy.get(p.id) || (byEmail ? orderBy.get(byEmail) : undefined) || null;
    const mine = ordersFor.get(p.id) || (byEmail ? ordersFor.get(byEmail) : undefined) || [];
    // Oldest order dates the first purchase; `orders` arrives newest-first.
    const firstOrder = mine.length
      ? mine.reduce((old, x) => (new Date(x.createdAt) < new Date(old.createdAt) ? x : old))
      : null;

    // Shopify knows far more about a checkout than our own beacons captured — name,
    // shipping address, line items, totals. Promote it onto the person so the table
    // shows it, not just the drawer. Our own data wins when we have it.
    const d = a?.detail;
    const addr = d?.address;
    const shopAddress = addr
      ? [addr.address1, addr.address2, addr.city, addr.province, addr.zip].filter(Boolean).join(', ')
      : null;
    const shopCart = d?.lines?.length
      ? {
          total: Number(d.total?.amount || a?.total?.amount || 0),
          currency: d.total?.currencyCode || a?.total?.currencyCode || 'INR',
          quantity: d.lines.reduce((n, l) => n + l.quantity, 0),
          lines: d.lines.map((l) => ({
            title: l.title,
            variant: l.variant,
            quantity: l.quantity,
            price: Number(l.price?.amount || 0),
          })),
        }
      : null;
    const cart = p.cart ?? shopCart;

    return {
      ...p,
      name: p.name || a?.customer || addr?.name || null,
      email: p.email || a?.email || null,
      address: p.address || shopAddress,
      items: p.items.length ? p.items : (d?.lines ?? []).map((l) => l.title),
      cart,
      cartValue: p.cartValue || Number(cart?.total || 0),
      cartCurrency: p.cart ? p.cartCurrency : (cart?.currency ?? p.cartCurrency),
      // Money stages outrank anything the browser told us.
      stage: o ? 'ordered' : a ? 'payment' : p.stage,
      abandoned: a,
      ordered: Boolean(o),
      orderTotal: Number(o?.total?.amount || 0),
      orderCount: mine.length,
      lifetimeValue: mine.reduce((s, x) => s + Number(x.total?.amount || 0), 0),
      daysToPurchase: daysBetween(p.firstSeen, firstOrder?.createdAt ?? null),
    };
  });

  return json({ demos, abandoned, orders, funnel, people: rows, products, affiliates });
};
