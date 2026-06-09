import type { APIRoute } from 'astro';
import { verifyWebhookSignature, finalizeOrder } from '~/lib/cashfree';

export const prerender = false;

// Cashfree payment webhook. Idempotently completes the Shopify draft order if the
// buyer paid but closed the tab before the return page finalized it. The signature
// is HMAC-SHA256 over (timestamp + raw body), so we must read the body as raw text.
export const POST: APIRoute = async ({ request }) => {
  const raw = await request.text();
  const timestamp = request.headers.get('x-webhook-timestamp') ?? '';
  const signature = request.headers.get('x-webhook-signature') ?? '';

  if (!verifyWebhookSignature(timestamp, raw, signature)) {
    return new Response('invalid signature', { status: 401 });
  }

  let payload: { type?: string; data?: { order?: { order_id?: string } } };
  try {
    payload = JSON.parse(raw);
  } catch {
    return new Response('bad payload', { status: 400 });
  }

  const orderId = payload.data?.order?.order_id;
  if (payload.type === 'PAYMENT_SUCCESS_WEBHOOK' && orderId) {
    // No cookies here (server-to-server) — the cart is cleared by the return page.
    const result = await finalizeOrder(orderId);
    if (result.status === 'error') {
      // Signal Cashfree to retry later rather than swallowing a transient failure.
      return new Response('finalize failed', { status: 500 });
    }
  }

  // Always 200 for handled/ignored event types so Cashfree stops retrying.
  return new Response('ok', { status: 200 });
};
