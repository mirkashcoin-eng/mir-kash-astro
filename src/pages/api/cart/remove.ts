import type { APIRoute } from 'astro';
import { removeLine } from '~/lib/shopify/cart';
import {
  resolveStore,
  resolveCheckoutCartId,
  persistCart,
  persistBuyNowCart,
} from '~/lib/cart-session';

export const prerender = false;

export const POST: APIRoute = async ({ request, cookies }) => {
  let body: { lineId?: string; store?: string; buynow?: boolean };
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400 });
  }

  const lineId = body.lineId;
  if (!lineId) {
    return new Response(JSON.stringify({ error: 'lineId required' }), { status: 400 });
  }

  // buynow → operate on the express single-item cart, else the main cart.
  const store = resolveStore(body.store);
  const isBuyNow = body.buynow === true;
  const cartId = resolveCheckoutCartId(cookies, store, isBuyNow);
  if (!cartId) {
    return new Response(JSON.stringify({ error: 'No cart' }), { status: 404 });
  }

  const cart = await removeLine(store, cartId, lineId);
  if (!cart) {
    return new Response(JSON.stringify({ error: 'Could not update cart' }), { status: 502 });
  }

  if (isBuyNow) persistBuyNowCart(cookies, store, cart);
  else persistCart(cookies, store, cart);
  return new Response(JSON.stringify(cart), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store' },
  });
};
