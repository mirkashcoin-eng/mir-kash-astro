import type { APIRoute } from 'astro';
import { createCart, addLines, updateBuyerIdentity } from '~/lib/shopify/cart';
import { resolveStore, getCartId, persistCart } from '~/lib/cart-session';

export const prerender = false;

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
  const countryCode = body.countryCode;
  const existingId = getCartId(cookies, store);
  const lines = [{ merchandiseId, quantity }];

  let cart = existingId ? await addLines(store, existingId, lines, countryCode) : null;
  // No cart yet, or the stored cart expired → create a fresh one in the local currency.
  if (!cart) cart = await createCart(store, lines, countryCode);
  // Sync buyer identity so checkout URL uses the correct country/currency.
  else if (countryCode && existingId) {
    const updated = await updateBuyerIdentity(store, existingId, countryCode);
    if (updated) cart = updated;
  }

  if (!cart) {
    return new Response(JSON.stringify({ error: 'Could not update cart' }), { status: 502 });
  }

  persistCart(cookies, store, cart);
  return new Response(JSON.stringify(cart), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store' },
  });
};
