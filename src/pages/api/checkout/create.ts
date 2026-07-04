import type { APIRoute } from 'astro';
import { resolveCheckoutCartId, clearCart, clearBuyNowCart } from '~/lib/cart-session';
import { getCart } from '~/lib/shopify/cart';
import { createDraftOrder, completeDraftOrder, type ShippingAddressInput } from '~/lib/shopify/admin';
import { createCashfreeOrder } from '~/lib/cashfree';

export const prerender = false;

// On Vercel, `url.origin` can resolve to http://localhost — which would make Cashfree
// redirect the buyer to a dead localhost page after paying (order never finalizes).
// Order of trust: explicit PUBLIC_APP_ORIGIN env → forwarded host → configured site.
function envOrigin(): string {
  const fromProcess = typeof process !== 'undefined' && process.env ? process.env.PUBLIC_APP_ORIGIN : '';
  const fromMeta = import.meta.env.PUBLIC_APP_ORIGIN as string | undefined;
  return (fromProcess || fromMeta || '').replace(/\/$/, '');
}
const PROD_ORIGIN = 'https://www.mirkash.com'; // hard guarantee: a payment callback is never localhost
function publicOrigin(request: Request, url: URL): string {
  const explicit = envOrigin();
  if (explicit) return explicit;
  const host = request.headers.get('x-forwarded-host') || request.headers.get('host') || url.host;
  const proto = request.headers.get('x-forwarded-proto') || (url.protocol.replace(':', '')) || 'https';
  if (host && !/^(localhost|127\.0\.0\.1|\[?::1)/.test(host)) return `${proto}://${host}`;
  const site = ((import.meta.env.SITE as string | undefined) || '').replace(/\/$/, '');
  if (site && !/localhost/.test(site)) return site;
  return PROD_ORIGIN; // never fall through to url.origin (which can be http://localhost on Vercel)
}

interface Body {
  fullName?: string;
  address1?: string;
  address2?: string;
  city?: string;
  province?: string;
  zip?: string;
  phone?: string;
  email?: string;
  buynow?: boolean;
  waOptin?: boolean;
  paymentMethod?: 'online' | 'cod';
}

function bad(message: string, status = 400) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function splitName(full: string): { firstName: string; lastName: string } {
  const parts = full.trim().split(/\s+/);
  const firstName = parts.shift() ?? '';
  return { firstName, lastName: parts.join(' ') || firstName };
}

// 10-digit Indian phone for Cashfree (strip country code / formatting).
function indianPhone(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  return digits.length > 10 ? digits.slice(-10) : digits;
}

export const POST: APIRoute = async ({ request, cookies, url }) => {
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return bad('Invalid JSON');
  }

  const fullName = (body.fullName ?? '').trim();
  const address1 = (body.address1 ?? '').trim();
  const city = (body.city ?? '').trim();
  const province = (body.province ?? '').trim();
  const zip = (body.zip ?? '').trim();
  const phone = (body.phone ?? '').trim();
  const email = (body.email ?? '').trim();

  // province (state) is optional — the checkout's combined "City & State" field
  // may not always yield a state; Shopify accepts a blank province.
  if (!fullName || !address1 || !city || !zip || !phone || !email) {
    return bad('Missing required fields');
  }

  // India cart only — custom checkout never touches the global store.
  // Buy-now uses the separate single-item cart; otherwise the main cart.
  const isBuyNow = body.buynow === true;
  const cartId = resolveCheckoutCartId(cookies, 'india', isBuyNow);
  if (!cartId) return bad('Cart is empty', 409);
  const cart = await getCart('india', cartId);
  if (!cart || cart.lines.length === 0) return bad('Cart is empty', 409);

  const lines = cart.lines.map((l) => ({ variantId: l.merchandiseId, quantity: l.quantity }));
  const { firstName, lastName } = splitName(fullName);
  const phone10 = indianPhone(phone);
  const phoneE164 = `+91${phone10}`; // Shopify requires E.164; Cashfree wants the bare 10 digits

  const address: ShippingAddressInput = {
    firstName,
    lastName,
    address1,
    address2: (body.address2 ?? '').trim(),
    city,
    province,
    zip,
    phone: phoneE164,
    country: 'IN',
  };

  const isCod = body.paymentMethod === 'cod';
  // Cashfree order id is generated up front (online only) and stored on the draft so
  // the reconciler can recover the order if the webhook + return page both miss it.
  const orderId = isCod ? '' : `mk_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  const discount = cart.discountAmount > 0
    ? { amount: cart.discountAmount, title: cart.discountCode || 'Discount' }
    : undefined;
  const draft = await createDraftOrder({ lines, address, email, phone: phoneE164, discount, optin: body.waOptin === true, cod: isCod, cfOrderId: orderId || undefined });
  if (!draft) return bad('Could not create order', 502);

  const amount = Number(draft.totalPrice.amount);
  if (!Number.isFinite(amount) || amount <= 0) return bad('Invalid order total', 502);

  // ── Cash on Delivery: no online payment. Complete the draft as "payment pending"
  // (a real order with money collected on delivery), clear the cart, and we're done.
  if (isCod) {
    const completed = await completeDraftOrder(draft.id, true);
    if (!completed) return bad('Could not place your order', 502);
    if (isBuyNow) clearBuyNowCart(cookies, 'india');
    else clearCart(cookies, 'india');
    return new Response(
      JSON.stringify({ cod: true, orderName: completed.orderName ?? completed.name }),
      { status: 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } },
    );
  }

  const origin = publicOrigin(request, url);
  const cf = await createCashfreeOrder({
    orderId,
    amount,
    customer: {
      id: `cust_${phone10}`,
      phone: phone10,
      email,
      name: fullName,
    },
    returnUrl: `${origin}/checkout/return`,
    notifyUrl: `${origin}/api/webhooks/cashfree`,
    draftOrderId: draft.id,
    cartKind: isBuyNow ? 'buynow' : 'main',
  });

  if (!cf) return bad('Payment init failed', 502);

  return new Response(
    JSON.stringify({
      paymentSessionId: cf.paymentSessionId,
      mode: import.meta.env.PUBLIC_CASHFREE_MODE === 'production' ? 'production' : 'sandbox',
    }),
    { status: 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } },
  );
};
