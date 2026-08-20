import type { APIRoute } from 'astro';
import { resolveCheckoutCartId } from '~/lib/cart-session';
import { applyDiscount } from '~/lib/shopify/cart';
import { couponLimitBlock, couponBlockMessage } from '~/lib/coupons';
import { INDIA_MARKET } from '~/lib/markets';

export const prerender = false;

// Apply (or clear, with empty code) a discount code on the India checkout cart.
// Returns the updated totals so the summary can re-render.
//
// INDIA-ONLY by construction, not by routing choice: the custom checkout this serves
// runs on the Shopify Admin API + Cashfree, neither of which serves the global store.
// Global markets check out on Shopify's hosted checkout and use /api/cart/apply-discount,
// which takes its store + country from the caller's market. The country here comes from
// the market registry (INDIA_MARKET) so this endpoint reads the cart in exactly the
// @inContext that /cart and /checkout rendered it in.
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

  const { cart, applied } = await applyDiscount('india', cartId, code ? [code] : [], INDIA_MARKET.countryCode);
  if (!cart) return new Response(JSON.stringify({ error: 'Could not update cart' }), { status: 502 });

  if (code && !applied) {
    return new Response(
      JSON.stringify({ ok: false, error: 'That code isn’t valid for this order.' }),
      { status: 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } },
    );
  }

  // Shopify still thinks the code is applicable — its usage counter never moves for
  // India orders (see lib/coupons.ts) — so enforce the limits against our own ledger.
  // Only the TOTAL cap is checkable here; "one per customer" needs a buyer and is
  // checked in checkout/create. Clearing the code off the cart is not optional:
  // leaving it applicable means create.ts would discount the order anyway.
  if (code && applied) {
    const block = await couponLimitBlock(code);
    if (block) {
      await applyDiscount('india', cartId, [], INDIA_MARKET.countryCode);
      return new Response(
        JSON.stringify({ ok: false, error: couponBlockMessage(block) }),
        { status: 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } },
      );
    }
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
