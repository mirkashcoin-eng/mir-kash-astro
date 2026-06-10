import type { APIRoute } from 'astro';
import { createCart } from '~/lib/shopify/cart';
import { resolveStore, persistBuyNowCart } from '~/lib/cart-session';

export const prerender = false;

// Amazon-style Buy Now: build a fresh single-item cart (separate from the main
// cart) so checking out one product never touches what's already in the bag.
// India → our custom checkout (`/checkout?buynow=1`); Global → that one-item
// cart's Shopify hosted checkout URL.
export const POST: APIRoute = async ({ request, cookies }) => {
  let body: { merchandiseId?: string; quantity?: number; store?: string; countryCode?: string };
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

  const store = resolveStore(body.store);
  const cart = await createCart(store, [{ merchandiseId, quantity }], body.countryCode);
  if (!cart) {
    return new Response(JSON.stringify({ error: 'Could not start buy-now' }), { status: 502 });
  }

  persistBuyNowCart(cookies, store, cart);

  const next = store === 'india' ? '/checkout?buynow=1' : cart.checkoutUrl;
  return new Response(JSON.stringify({ next }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store' },
  });
};
