import type { APIRoute } from 'astro';
import { getCashfreeOrder, isAbandoned } from '~/lib/cashfree';

export const prerender = false;

// "What happened to the payment I started?"
//
// This exists to close a double-payment hole. The checkout page disables its pay
// button on the way to the gateway, and nothing re-enables it — so today a buyer who
// cancels comes back to a dead page. The obvious fix (re-enable on return) would let
// someone who ALREADY PAID and then pressed Back pay a second time. The dead button
// is, by accident, the only thing preventing that right now.
//
// So the page asks here first, and only re-enables when this says the order was not
// paid. Read-only: it never creates or completes anything.
export const GET: APIRoute = async ({ url }) => {
  const orderId = (url.searchParams.get('order_id') ?? '').trim();
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store' },
    });

  if (!orderId) return json({ error: 'order_id required' }, 400);

  const cf = await getCashfreeOrder(orderId);
  // TEMPORARY — fires on every check, unlike the [cashfree][probe] line in
  // getPaymentAttempts which only runs for ACTIVE orders. Silence there told us
  // nothing: it could mean a cancelled order isn't ACTIVE, or that this endpoint was
  // never reached at all. This distinguishes the two. Remove once confirmed.
  console.error('[cashfree][probe] status', orderId, cf ? cf.orderStatus : 'LOOKUP_FAILED');

  // Unknown order, or Cashfree unreachable. Fail CLOSED — reporting "not paid" on a
  // failed lookup is exactly how someone gets charged twice.
  if (!cf) return json({ state: 'unknown' });

  if (cf.orderStatus === 'PAID') return json({ state: 'paid' });

  // EXPIRED / TERMINATED are unambiguously over. ACTIVE is the ambiguous one: both a
  // cancelled checkout and an in-flight UPI approval look like this, so ask whether
  // any payment was actually attempted.
  if (cf.orderStatus !== 'ACTIVE') return json({ state: 'cancelled' });

  return json({ state: (await isAbandoned(orderId)) ? 'cancelled' : 'pending' });
};
