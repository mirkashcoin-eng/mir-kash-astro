import type { APIRoute } from 'astro';
import { verifyFirebaseUser } from '~/lib/firebaseAuth';
import { getOrdersByEmail, cancelOrder } from '~/lib/shopify/admin';

export const prerender = false;

// Cancels an order at the customer's request. Verifies the order belongs to the
// signed-in user, and only allows it while the order is unfulfilled (not yet shipped)
// and not already cancelled. Prepaid orders are flagged for a manual Cashfree refund.
export const POST: APIRoute = async ({ request }) => {
  const token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  const user = await verifyFirebaseUser(token);
  if (!user) return new Response(JSON.stringify({ error: 'Not signed in' }), { status: 401 });

  let body: { orderId?: string };
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400 });
  }
  const orderId = (body.orderId ?? '').trim();
  if (!orderId) return new Response(JSON.stringify({ error: 'orderId required' }), { status: 400 });

  // Ownership: the order must be one of this user's orders.
  const own = await getOrdersByEmail(user.email);
  const order = own.find((o) => o.id === orderId);
  if (!order) return new Response(JSON.stringify({ error: 'Order not found' }), { status: 403 });

  if (order.cancelledAt) {
    return new Response(JSON.stringify({ error: 'This order is already cancelled.' }), { status: 409 });
  }

  const fs = (order.fulfillmentStatus || '').toUpperCase();
  const shipped = fs.includes('FULFILLED') && !fs.includes('UNFULFILLED');
  if (shipped) {
    return new Response(
      JSON.stringify({ error: 'This order has already shipped and can’t be cancelled. Please request a return instead.' }),
      { status: 409, headers: { 'Content-Type': 'application/json' } },
    );
  }

  // Prepaid (money already collected online) → team refunds via Cashfree. COD owes nothing.
  const refundPending = /paid/i.test(order.financialStatus);
  const ok = await cancelOrder(orderId, { refundPending });

  return new Response(JSON.stringify({ ok, refundPending }), {
    status: ok ? 200 : 502,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
};
