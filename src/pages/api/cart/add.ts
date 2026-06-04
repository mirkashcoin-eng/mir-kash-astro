import type { APIRoute } from 'astro';
import { createCart, addLines } from '~/lib/shopify/cart';
import { resolveMarket, getCartId, persistCart } from '~/lib/cart-session';

export const prerender = false;

export const POST: APIRoute = async ({ request, cookies }) => {
  let body: { merchandiseId?: string; quantity?: number; market?: string };
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400 });
  }

  const merchandiseId = body.merchandiseId;
  const quantity = Math.max(1, Number(body.quantity) || 1);
  if (!merchandiseId) {
    return new Response(JSON.stringify({ error: 'merchandiseId required' }), { status: 400 });
  }

  const market = resolveMarket(body.market);
  const existingId = getCartId(cookies, market);
  const lines = [{ merchandiseId, quantity }];

  let cart = existingId ? await addLines(market, existingId, lines) : null;
  // No cart yet, or the stored cart expired/was lost → create a fresh one.
  if (!cart) cart = await createCart(market, lines);

  if (!cart) {
    return new Response(JSON.stringify({ error: 'Could not update cart' }), { status: 502 });
  }

  persistCart(cookies, market, cart);
  return new Response(JSON.stringify(cart), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
