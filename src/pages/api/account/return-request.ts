import type { APIRoute } from 'astro';
import { verifyFirebaseUser } from '~/lib/firebaseAuth';
import { getOrdersByEmail, requestReturn } from '~/lib/shopify/admin';

export const prerender = false;

// Flags an order for return. Verifies the order belongs to the signed-in user
// (by matching it against their own orders) before tagging it in Shopify.
export const POST: APIRoute = async ({ request }) => {
  const token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  const user = await verifyFirebaseUser(token);
  if (!user) return new Response(JSON.stringify({ error: 'Not signed in' }), { status: 401 });

  let body: { orderId?: string; reason?: string };
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400 });
  }
  const orderId = (body.orderId ?? '').trim();
  if (!orderId) return new Response(JSON.stringify({ error: 'orderId required' }), { status: 400 });

  // Ownership: the order must be one of this user's orders.
  const own = await getOrdersByEmail(user.email);
  if (!own.some((o) => o.id === orderId)) {
    return new Response(JSON.stringify({ error: 'Order not found' }), { status: 403 });
  }

  const ok = await requestReturn(orderId, (body.reason ?? '').slice(0, 300));
  return new Response(JSON.stringify({ ok }), {
    status: ok ? 200 : 502,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
};
