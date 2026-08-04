import type { APIRoute } from 'astro';
import { verifyFirebaseUser } from '~/lib/firebaseAuth';
import { isAdmin, passcodeOk } from '~/lib/adminAuth';
import { getDemoBookings, getAbandonedCheckouts, getRecentOrders } from '~/lib/shopify/admin';

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

// Founders-only data feed for /admin. Auth = Firebase ID token (Bearer) whose email
// must be in the ADMIN_EMAILS allowlist. India Admin data only.
export const GET: APIRoute = async ({ request }) => {
  // Two ways in: a shared passcode (x-admin-key header) OR a Firebase admin token.
  const key = request.headers.get('x-admin-key');
  let ok = passcodeOk(key);
  if (!ok) {
    const token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
    const user = token ? await verifyFirebaseUser(token) : null;
    ok = Boolean(user && isAdmin(user.email));
  }
  if (!ok) return json({ error: 'Not authorised' }, 401);

  const [demos, abandoned, orders] = await Promise.all([
    getDemoBookings(),
    getAbandonedCheckouts(),
    getRecentOrders(),
  ]);
  return json({ demos, abandoned, orders });
};
