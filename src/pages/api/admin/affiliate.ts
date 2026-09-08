import type { APIRoute } from 'astro';
import { requestRole } from '~/lib/adminAuth';
import { createAffiliate, getAffiliateSummary, SLUG_RE } from '~/lib/clicks';
import { getRecentOrders } from '~/lib/shopify/admin';

export const prerender = false;

const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex, nofollow' },
  });

// Affiliate links: founders and the restricted 'affiliate' role both get in — this
// is the one resource the affiliate role is scoped to. Everything else under
// /api/admin/* stays founders-only (requestIsAdmin).
async function authorised(request: Request): Promise<boolean> {
  const role = await requestRole(request);
  return role === 'full' || role === 'affiliate';
}

// Affiliate performance — clicks, orders, revenue per link. The affiliate-only
// dashboard view loads from here instead of /api/admin/data, which it can't reach.
export const GET: APIRoute = async ({ request }) => {
  if (!(await authorised(request))) return json({ error: 'Not authorised' }, 401);
  const orders = await getRecentOrders();
  const affiliates = await getAffiliateSummary(orders);
  return json({ affiliates });
};

// Mint an affiliate link.
export const POST: APIRoute = async ({ request }) => {
  if (!(await authorised(request))) return json({ error: 'Not authorised' }, 401);

  let body: { slug?: string; label?: string };
  try { body = await request.json(); } catch { return json({ error: 'Bad request' }, 400); }

  const slug = (body.slug || '').trim().toLowerCase();
  if (!SLUG_RE.test(slug)) {
    return json({ error: 'Use 3–40 characters: lowercase letters, numbers and hyphens.' }, 400);
  }

  const res = await createAffiliate(slug, (body.label || '').trim() || undefined);
  if (res === 'taken') return json({ error: `“${slug}” is already taken.` }, 409);
  if (res === 'unavailable') return json({ error: 'Firestore service account not configured' }, 503);
  return json({ ok: true, slug });
};
