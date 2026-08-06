import type { APIRoute } from 'astro';
import { requestIsAdmin } from '~/lib/adminAuth';
import { getDemoBookings, getAbandonedCheckouts, getAbandonedDrafts, getRecentOrders } from '~/lib/shopify/admin';
import { getFunnel, getProductStats } from '~/lib/analytics';
import { getPeople, personKey, type Person } from '~/lib/leads';

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
  abandoned: unknown | null;
  ordered: boolean;
  orderTotal: number;
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

  // Overlay Shopify state onto each person, matched on the same phone key the People
  // collection is keyed by (falling back to email, which the global store fills in).
  const abandonedBy = new Map<string, (typeof abandoned)[number]>();
  for (const a of abandoned) {
    const k = personKey(a.phone) || (a.email || '').toLowerCase();
    if (k && !abandonedBy.has(k)) abandonedBy.set(k, a);
  }
  const orderBy = new Map<string, (typeof orders)[number]>();
  for (const o of orders) {
    if (o.cancelled) continue;
    const k = personKey(o.phone) || (o.email || '').toLowerCase();
    if (k && !orderBy.has(k)) orderBy.set(k, o);
  }

  const rows: PersonRow[] = (people ?? []).map((p) => {
    const byEmail = (p.email || '').toLowerCase();
    const a = abandonedBy.get(p.id) || (byEmail ? abandonedBy.get(byEmail) : undefined) || null;
    const o = orderBy.get(p.id) || (byEmail ? orderBy.get(byEmail) : undefined) || null;
    return {
      ...p,
      // Money stages outrank anything the browser told us.
      stage: o ? 'ordered' : a ? 'payment' : p.stage,
      abandoned: a,
      ordered: Boolean(o),
      orderTotal: Number(o?.total?.amount || 0),
    };
  });

  return json({ demos, abandoned, orders, funnel, people: rows, products });
};
