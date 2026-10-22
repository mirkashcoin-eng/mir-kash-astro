import type { APIRoute } from 'astro';
import { requestIsAdmin } from '~/lib/adminAuth';
import { getDemoBookings, getPrivateViewingBookings, getAbandonedCheckouts, getAbandonedDrafts, getRecentOrders, type AbandonedCheckout } from '~/lib/shopify/admin';
import { getBannerTestCounts, getCartExitStats, getFunnel, getProductStats, getPromptStats, getTryAtHomeStats } from '~/lib/analytics';
import { getTryAtHomePanels } from '~/lib/warehouse/panels';
import { verdict, MIN_DAYS, MIN_PER_ARM } from '~/lib/ab-test';
import { getPeople, personKey, type BookingProgress, type Person } from '~/lib/leads';
import { getAffiliateSummary } from '~/lib/clicks';
import { getSubscribers } from '~/lib/newsletter';
import { getFunnelDaily } from '~/lib/funnel';

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
// must be a root founder (ADMIN_EMAILS) or hold the 'full' role in Team access.
// India Admin data only.
export const GET: APIRoute = async ({ request }) => {
  if (!(await requestIsAdmin(request))) return json({ error: 'Not authorised' }, 401);

  const [demos, viewings, nativeAbandoned, draftAbandoned, orders, funnel, people, products, subscribers, funnelDaily, panels] = await Promise.all([
    getDemoBookings(),
    getPrivateViewingBookings(),
    getAbandonedCheckouts(), // Global store — Shopify-hosted checkout
    getAbandonedDrafts(),    // India store — open Cashfree payment drafts
    getRecentOrders(),
    getFunnel(30),           // first-party visitor funnel (anonymous)
    getPeople(500),          // durable people (phone-keyed), with their journey data
    getProductStats(20),     // most-viewed products
    getSubscribers(1000),    // newsletter signups (Firestore)
    getFunnelDaily(240),     // immutable per-day funnel counts (Daily funnel grid)
    getTryAtHomePanels(),    // Try at Home counters from Neon (legacy copy + event log)
  ]);
  // Neon first; Firestore only if the database is unreachable (it runs out of daily quota).
  const [prompt, cartExit, tryAtHome, bannerCounts] = panels
    ? [panels.prompt, panels.cartExit, panels.tryAtHome, panels.bannerCounts]
    : await Promise.all([getPromptStats(30), getCartExitStats(30), getTryAtHomeStats(30), getBannerTestCounts()]);
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

  // Try at Home / Private Viewing bookings in Shopify, by phone, so a person's booking
  // progress can say whether it ended in a booking. Newest first, so the latest wins.
  const bookedBy = new Map<string, { flow: BookingProgress['flow']; b: (typeof demos)[number] | (typeof viewings)[number] }>();
  for (const d of demos) { const k = personKey(d.phone); if (k && !bookedBy.has(k)) bookedBy.set(k, { flow: 'try_at_home', b: d }); }
  for (const v of viewings) { const k = personKey(v.phone); if (k && !bookedBy.has(k)) bookedBy.set(k, { flow: 'private_viewing', b: v }); }
  function bookingFor(p: Person): BookingProgress | null {
    const hit = bookedBy.get(p.id);
    if (!hit) return p.booking;
    // A booking made before progress was recorded still shows, built from Shopify.
    const base: BookingProgress = p.booking && p.booking.flow === hit.flow ? p.booking : {
      flow: hit.flow, step: 'details', date: hit.b.date || null, slot: hit.b.slot || null,
      count: null, bags: hit.b.bags ? hit.b.bags.split(',').map((s) => s.trim()).filter(Boolean) : [],
      at: hit.b.createdAt || null,
    };
    return { ...base, booked: hit.b.status };
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
      booking: bookingFor(p),
      abandoned: a,
      ordered: Boolean(o),
      orderTotal: Number(o?.total?.amount || 0),
      orderCount: mine.length,
      lifetimeValue: mine.reduce((s, x) => s + Number(x.total?.amount || 0), 0),
      daysToPurchase: daysBetween(p.firstSeen, firstOrder?.createdAt ?? null),
    };
  });

  // Phone banner test: per-version counts plus the verdict (src/lib/ab-test.ts).
  // "Chose pieces" = reached the day-and-time step.
  const bannerTest = bannerCounts && bannerCounts.firstDay
    ? {
        ...bannerCounts,
        minPerArm: MIN_PER_ARM,
        minDays: MIN_DAYS,
        verdict: verdict(
          { visitors: bannerCounts.A.th_view, choseP: bannerCounts.A.th_datetime, booked: bannerCounts.A.th_booked },
          { visitors: bannerCounts.B.th_view, choseP: bannerCounts.B.th_datetime, booked: bannerCounts.B.th_booked },
          bannerCounts.days,
        ),
      }
    : null;

  return json({ demos, viewings, abandoned, orders, funnel, people: rows, products, affiliates, subscribers, funnelDaily, prompt, cartExit, tryAtHome, bannerTest });
};
