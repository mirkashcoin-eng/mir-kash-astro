import type { APIRoute } from 'astro';
import { removeLine } from '~/lib/shopify/cart';
import { resolveMarket, getCartId, persistCart } from '~/lib/cart-session';

export const prerender = false;

export const POST: APIRoute = async ({ request, cookies }) => {
  let body: { lineId?: string; market?: string };
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400 });
  }

  const lineId = body.lineId;
  if (!lineId) {
    return new Response(JSON.stringify({ error: 'lineId required' }), { status: 400 });
  }

  const market = resolveMarket(body.market);
  const cartId = getCartId(cookies, market);
  if (!cartId) {
    return new Response(JSON.stringify({ error: 'No cart' }), { status: 404 });
  }

  const cart = await removeLine(market, cartId, lineId);
  if (!cart) {
    return new Response(JSON.stringify({ error: 'Could not update cart' }), { status: 502 });
  }

  persistCart(cookies, market, cart);
  return new Response(JSON.stringify(cart), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
