import type { APIRoute } from 'astro';
import crypto from 'node:crypto';
import { notifyOrderShipped } from '~/lib/whatsapp';

export const prerender = false;

// Shopify webhook receiver (India store). Currently handles `orders/fulfilled` to send
// the "order shipped" WhatsApp INSTANTLY — the moment you click Fulfil in Shopify —
// instead of waiting for the daily cron. Read-only + best-effort: it never touches the
// checkout/payment flow, and a WhatsApp failure can't affect the order.
//
// Shopify signs every webhook with HMAC-SHA256 over the RAW body, base64, keyed with the
// app's client secret (SHOPIFY_IN_ADMIN_CLIENT_SECRET — same app that runs the checkout).
// We must read the body as raw text to verify it. Registered via /api/admin/shopify-hooks.

function env(k: string): string {
  if (typeof process !== 'undefined' && process.env && process.env[k]) return process.env[k] as string;
  const m = import.meta.env as Record<string, string | undefined>;
  return m[k] ?? '';
}

function verify(rawBody: string, hmacHeader: string): boolean {
  const secret = env('SHOPIFY_IN_ADMIN_CLIENT_SECRET');
  if (!secret || !hmacHeader) return false;
  const expected = crypto.createHmac('sha256', secret).update(rawBody, 'utf8').digest('base64');
  try {
    const a = Buffer.from(expected);
    const b = Buffer.from(hmacHeader);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

// The orders/fulfilled payload is the full Order (REST shape): it carries note_attributes
// (where wa_optin lives), the order name, and the customer's name + phone — so no extra
// Shopify fetch is needed.
interface OrderPayload {
  name?: string;
  note_attributes?: Array<{ name?: string; value?: string }>;
  phone?: string | null;
  customer?: { first_name?: string | null; phone?: string | null } | null;
  shipping_address?: { first_name?: string | null; phone?: string | null } | null;
}

function noteAttr(payload: OrderPayload, key: string): string | null {
  const hit = (payload.note_attributes ?? []).find((a) => a?.name === key);
  return hit?.value ?? null;
}

export const POST: APIRoute = async ({ request }) => {
  const raw = await request.text();
  const hmac = request.headers.get('x-shopify-hmac-sha256') ?? '';

  if (!verify(raw, hmac)) {
    return new Response('invalid signature', { status: 401 });
  }

  const topic = request.headers.get('x-shopify-topic') ?? '';

  let payload: OrderPayload;
  try {
    payload = JSON.parse(raw) as OrderPayload;
  } catch {
    return new Response('bad payload', { status: 400 });
  }

  if (topic === 'orders/fulfilled') {
    const orderName = payload.name ?? null;
    const phone =
      payload.shipping_address?.phone || payload.customer?.phone || payload.phone || null;
    const customerName = payload.shipping_address?.first_name || payload.customer?.first_name || null;
    const waOptin = noteAttr(payload, 'wa_optin') === 'true';
    // Best-effort; de-duped with the daily cron via the shared `ship:{orderName}` lock.
    await notifyOrderShipped({ orderName, customerName, phone, waOptin });
  }

  // Always 200 for handled/ignored topics so Shopify stops retrying.
  return new Response('ok', { status: 200 });
};
