import type { APIRoute } from 'astro';
import { getCartId } from '~/lib/cart-session';
import { getCart } from '~/lib/shopify/cart';
import { createDraftOrder, type ShippingAddressInput } from '~/lib/shopify/admin';
import { createCashfreeOrder } from '~/lib/cashfree';
import { saveLead } from '~/lib/firestore';

export const prerender = false;

interface Body {
  fullName?: string;
  address1?: string;
  address2?: string;
  city?: string;
  province?: string;
  zip?: string;
  phone?: string;
  email?: string;
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

  if (!fullName || !address1 || !city || !province || !zip || !phone || !email) {
    return bad('Missing required fields');
  }

  // India cart only — custom checkout never touches the global store.
  const cartId = getCartId(cookies, 'india');
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

  const draft = await createDraftOrder({ lines, address, email, phone: phoneE164 });
  if (!draft) return bad('Could not create order', 502);

  const amount = Number(draft.totalPrice.amount);
  if (!Number.isFinite(amount) || amount <= 0) return bad('Invalid order total', 502);

  const orderId = `mk_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const cf = await createCashfreeOrder({
    orderId,
    amount,
    customer: {
      id: `cust_${phone10}`,
      phone: phone10,
      email,
      name: fullName,
    },
    returnUrl: `${url.origin}/checkout/return`,
    notifyUrl: `${url.origin}/api/webhooks/cashfree`,
    draftOrderId: draft.id,
  });

  if (!cf) return bad('Payment init failed', 502);

  // Capture the lead in Firestore (best-effort; never blocks checkout).
  await saveLead(orderId, {
    draftOrderId: draft.id,
    fullName,
    email,
    phone: phone10,
    address: { address1, address2: address.address2 ?? '', city, province, zip },
    amount,
    currency: draft.totalPrice.currencyCode || 'INR',
    items: cart.lines.map((l) => ({ title: l.title, qty: l.quantity, price: l.price })),
  });

  return new Response(
    JSON.stringify({
      paymentSessionId: cf.paymentSessionId,
      mode: import.meta.env.PUBLIC_CASHFREE_MODE === 'production' ? 'production' : 'sandbox',
    }),
    { status: 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } },
  );
};
