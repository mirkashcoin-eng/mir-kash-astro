import type { APIRoute } from 'astro';
import { updateLine } from '~/lib/shopify/cart';
import { resolveStore, getCartId, persistCart } from '~/lib/cart-session';

export const prerender = false;

export const POST: APIRoute = async ({ request, cookies }) => {
  let body: { lineId?: string; quantity?: number; store?: string };
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400 });
  }

  const lineId = body.lineId;
  const quantity = Math.max(0, Number(body.quantity) || 0);
  if (!lineId) {
    return new Response(JSON.stringify({ error: 'lineId required' }), { status: 400 });
  }

  const store = resolveStore(body.store);
  const cartId = getCartId(cookies, store);
  if (!cartId) {
    return new Response(JSON.stringify({ error: 'No cart' }), { status: 404 });
  }

  const cart = await updateLine(store, cartId, lineId, quantity);
  if (!cart) {
    return new Response(JSON.stringify({ error: 'Could not update cart' }), { status: 502 });
  }

  persistCart(cookies, store, cart);
  return new Response(JSON.stringify(cart), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store' },
  });
};
