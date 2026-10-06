import type { APIRoute } from 'astro';
import { createCart, addLines, updateBuyerIdentity } from '~/lib/shopify/cart';
import { resolveStore, getCartId, persistCart } from '~/lib/cart-session';
import { sendMetaEvent } from '~/lib/meta-capi';
import { SITE_ORIGIN } from '~/lib/markets';

export const prerender = false;

export const POST: APIRoute = async (ctx) => {
  const { request, cookies } = ctx;
  let body: { merchandiseId?: string; quantity?: number; store?: string; countryCode?: string; fbEventId?: string };
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

  // Meta Conversions API — server-side mirror of the browser AddToCart pixel. Shares
  // fbEventId with the client's fbq('track','AddToCart', …, {eventID}) call so Meta
  // dedupes the two instead of double-counting. India only, same as the Purchase hook
  // in completeDraftOrder: the Global pixel's AddToCart still fires client-side only.
  if (store === 'india' && body.fbEventId) {
    const added = cart.lines.find((l) => l.merchandiseId === merchandiseId);
    let ip: string | undefined;
    try { ip = ctx.clientAddress; } catch { /* unsupported on this adapter/route */ }
    await sendMetaEvent({
      eventName: 'AddToCart',
      eventId: body.fbEventId,
      sourceUrl: SITE_ORIGIN,
      user: {
        ip,
        userAgent: request.headers.get('user-agent'),
        fbp: cookies.get('_fbp')?.value,
        fbc: cookies.get('_fbc')?.value,
      },
      customData: {
        currency: cart.currency,
        value: added ? added.price * quantity : undefined,
        content_type: 'product',
        contents: [{ id: merchandiseId, quantity }],
      },
    });
  }

  return new Response(JSON.stringify(cart), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store' },
  });
};
