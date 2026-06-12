import type { APIRoute } from 'astro';
import { verifyFirebaseUser } from '~/lib/firebaseAuth';
import { getOrdersByEmail } from '~/lib/shopify/admin';

export const prerender = false;

// Returns the signed-in customer's orders. Auth = a Firebase ID token in the
// Authorization header; the verified email is the only thing that unlocks orders.
export const GET: APIRoute = async ({ request }) => {
  const token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  const user = await verifyFirebaseUser(token);
  if (!user) return new Response(JSON.stringify({ error: 'Not signed in' }), { status: 401 });

  const orders = await getOrdersByEmail(user.email);
  return new Response(JSON.stringify({ orders }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store' },
  });
};
