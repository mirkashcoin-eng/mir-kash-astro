import type { APIRoute } from 'astro';
import { parseWebhook, verifySignature } from '~/lib/whatsapp-inbox';
import { upsertContacts, upsertInbound, upsertStatuses, waStoreConfigured } from '~/lib/whatsapp-store';

export const prerender = false;

function env(k: string): string {
  if (typeof process !== 'undefined' && process.env && process.env[k]) return process.env[k] as string;
  const m = import.meta.env as Record<string, string | undefined>;
  return m[k] ?? '';
}

// WhatsApp Cloud API webhook — feeds the inbox at /admin/whatsapp.
//  GET  — Meta's verification handshake: echoes hub.challenge when the verify token
//         matches WHATSAPP_VERIFY_TOKEN. This is all that's needed to "Verify and save".
//  POST — inbound events: customer replies, delivery/read/failed receipts, profile names.
//         Signed by Meta (X-Hub-Signature-256 = HMAC-SHA256 of the raw body with
//         WHATSAPP_APP_SECRET); fails closed: a bad signature gets 401, and with no secret
//         set nothing is stored. Verified events go to the WhatsApp Supabase store. Every
//         write is idempotent, so a store failure returns 500 and lets Meta retry.
//         Kept fast: no Graph API, Shopify or Firestore calls here.

const ok = () => new Response('ok', { status: 200, headers: { 'Cache-Control': 'no-store' } });

// Warn once per instance (not per request) about missing setup.
let warnedNoSecret = false;
let warnedNoStore = false;

export const GET: APIRoute = ({ url }) => {
  const mode = url.searchParams.get('hub.mode');
  const token = url.searchParams.get('hub.verify_token');
  const challenge = url.searchParams.get('hub.challenge') ?? '';
  const verify = env('WHATSAPP_VERIFY_TOKEN');
  if (mode === 'subscribe' && verify && token === verify) {
    return new Response(challenge, { status: 200, headers: { 'Content-Type': 'text/plain' } });
  }
  return new Response('forbidden', { status: 403 });
};

export const POST: APIRoute = async ({ request }) => {
  let raw: string;
  try { raw = await request.text(); } catch { return new Response('bad request', { status: 400, headers: { 'Cache-Control': 'no-store' } }); }

  // No secret → can't verify → drop it. 200 so Meta doesn't retry forever; we'd rather
  // lose the event than store something unverified.
  const secret = env('WHATSAPP_APP_SECRET');
  if (!secret) {
    if (!warnedNoSecret) { warnedNoSecret = true; console.warn('[wa-webhook] WHATSAPP_APP_SECRET not set — events acknowledged but not stored'); }
    return ok();
  }
  let valid = false;
  try { valid = await verifySignature(raw, request.headers.get('x-hub-signature-256'), secret); } catch { valid = false; }
  if (!valid) return new Response('invalid signature', { status: 401, headers: { 'Cache-Control': 'no-store' } });

  // Signed but unparseable: Meta resending it won't help, so acknowledge.
  let body: unknown;
  try { body = JSON.parse(raw); } catch {
    console.warn('[wa-webhook] signed body is not JSON; ignored');
    return ok();
  }
  const { inbound, statuses, contacts } = parseWebhook(body);

  if (!waStoreConfigured()) {
    if (!warnedNoStore) { warnedNoStore = true; console.warn('[wa-webhook] WhatsApp store not configured — events acknowledged but not stored'); }
    return ok();
  }
  let stored = false;
  try {
    const results = await Promise.all([
      contacts.length ? upsertContacts(contacts) : true,
      inbound.length ? upsertInbound(inbound) : true,
      statuses.length ? upsertStatuses(statuses) : true,
    ]);
    stored = results.every(Boolean);
  } catch { stored = false; }
  // Any write failed → 500 so Meta retries (safe: every write is idempotent).
  if (!stored) return new Response('store failed', { status: 500, headers: { 'Cache-Control': 'no-store' } });
  return ok();
};
