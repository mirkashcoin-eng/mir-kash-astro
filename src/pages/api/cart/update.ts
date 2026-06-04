import type { APIRoute } from 'astro';
import { updateLine } from '~/lib/shopify/cart';
import { resolveMarket, getCartId, persistCart } from '~/lib/cart-session';

export const prerender = false;

export const POST: APIRoute = async ({ request, cookies }) => {
  let body: { lineId?: string; quantity?: number; market?: string };
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

  const market = resolveMarket(body.market);
  const cartId = getCartId(cookies, market);
  if (!cartId) {
    return new Response(JSON.stringify({ error: 'No cart' }), { status: 404 });
  }

  // quantity 0 removes the line (Shopify cartLinesUpdate behaviour).
  const cart = await updateLine(market, cartId, lineId, quantity);
  if (!cart) {
    return new Response(JSON.stringify({ error: 'Could not update cart' }), { status: 502 });
  }

  persistCart(cookies, market, cart);
  return new Response(JSON.stringify(cart), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
