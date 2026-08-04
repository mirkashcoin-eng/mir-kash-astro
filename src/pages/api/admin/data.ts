import type { APIRoute } from 'astro';
import { verifyFirebaseUser } from '~/lib/firebaseAuth';
import { isAdmin } from '~/lib/adminAuth';
import { getDemoBookings, getAbandonedCheckouts } from '~/lib/shopify/admin';

export const prerender = false;

const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store' },
  });

// Founders-only data feed for /admin. Auth = Firebase ID token (Bearer) whose email
// must be in the ADMIN_EMAILS allowlist. India Admin data only.
export const GET: APIRoute = async ({ request }) => {
  const token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  const user = await verifyFirebaseUser(token);
  if (!user) return json({ error: 'Not signed in' }, 401);
  if (!isAdmin(user.email)) return json({ error: 'Not authorised' }, 403);

  const [demos, abandoned] = await Promise.all([getDemoBookings(), getAbandonedCheckouts()]);
  return json({ demos, abandoned });
};
