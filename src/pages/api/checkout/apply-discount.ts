import type { APIRoute } from 'astro';
import { resolveCheckoutCartId } from '~/lib/cart-session';
import { applyDiscount } from '~/lib/shopify/cart';

export const prerender = false;

// Apply (or clear, with empty code) a discount code on the India checkout cart.
// Returns the updated totals so the summary can re-render.
export const POST: APIRoute = async ({ request, cookies }) => {
  let body: { code?: string; buynow?: boolean };
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400 });
  }

  const code = (body.code ?? '').trim();
  const cartId = resolveCheckoutCartId(cookies, 'india', body.buynow === true);
  if (!cartId) return new Response(JSON.stringify({ error: 'No cart' }), { status: 409 });

  const { cart, applied } = await applyDiscount('india', cartId, code ? [code] : []);
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
