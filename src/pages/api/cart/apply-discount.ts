import type { APIRoute } from 'astro';
import { getCartId, resolveStore } from '~/lib/cart-session';
import { applyDiscount } from '~/lib/shopify/cart';

export const prerender = false;

// Apply (or clear, with empty code) a discount code on the visitor's main cart,
// for either store. Returns updated totals so the cart summary can re-render.
// The global store's code carries through the Storefront cart into Shopify's
// hosted checkout automatically; India's custom checkout reapplies it to the draft.
export const POST: APIRoute = async ({ request, cookies }) => {
  let body: { store?: string; code?: string };
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400 });
  }

  const store = resolveStore(body.store);
  const code = (body.code ?? '').trim();
  const cartId = getCartId(cookies, store);
  if (!cartId) return new Response(JSON.stringify({ error: 'No cart' }), { status: 409 });

  const { cart, applied } = await applyDiscount(store, cartId, code ? [code] : []);
  if (!cart) return new Response(JSON.stringify({ error: 'Could not update cart' }), { status: 502 });

  if (code && !applied) {
    return new Response(
      JSON.stringify({ ok: false, error: 'That code isn’t valid for this order.' }),
      { status: 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } },
    );
  }

  return new Response(
    JSON.stringify({
      ok: true,
      code: cart.discountCode,
      subtotal: cart.subtotal,
      discount: cart.discountAmount,
      total: cart.total,
    }),
    { status: 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } },
  );
};
