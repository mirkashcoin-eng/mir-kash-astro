// WhatsApp sending via the Meta Cloud API. Order messages (confirmed / shipped / cancelled /
// refund) are NOT sent from here — the Supabase service does that (whatsapp/). Business-
// initiated messages are pre-approved templates (sendTemplate); free text (sendText) is only for a founder's reply from the
// inbox at /admin/whatsapp, inside the customer's 24h window. Every template send is also
// logged to the WhatsApp Supabase store (messages_out, source='site') so the inbox shows
// it. Isolated + best-effort: never throws, so a messaging failure can never affect an
// order or a cron's other work.
import { adminDb } from './firebaseAdmin';
import { insertOut, waStoreConfigured } from './whatsapp-store';
import type { WaOutRow } from './whatsapp-types';

function env(k: string): string {
  if (typeof process !== 'undefined' && process.env && process.env[k]) return process.env[k] as string;
  const m = import.meta.env as Record<string, string | undefined>;
  return m[k] ?? '';
}

const GRAPH = 'https://graph.facebook.com/v21.0';

export function whatsappConfigured(): boolean {
  return Boolean(env('WHATSAPP_TOKEN') && env('WHATSAPP_PHONE_NUMBER_ID'));
}

// Meta wants country-code + number, digits only (e.g. 919876543210). A bare
// 10-digit Indian mobile is assumed +91.
export function waNumber(phone: string | null | undefined): string {
  let d = String(phone ?? '').replace(/[^0-9]/g, '');
  if (d.length === 10) d = '91' + d;
  return d;
}

// Send a pre-approved template. Returns true on success; logs and returns false on
// any failure. Never throws. Every attempt that reached Meta is also logged to
// messages_out (best-effort) so it shows in the inbox.
export async function sendTemplate(
  toPhone: string,
  template: string,
  bodyParams: string[] = [],
  langCode = 'en',
): Promise<boolean> {
  if (!whatsappConfigured()) return false;
  const to = waNumber(toPhone);
  if (to.length < 11) return false; // no usable number
  const phoneNumberId = env('WHATSAPP_PHONE_NUMBER_ID');
  const body = {
    messaging_product: 'whatsapp',
    to,
    type: 'template',
    template: {
      name: template,
      language: { code: langCode },
      ...(bodyParams.length
        ? { components: [{ type: 'body', parameters: bodyParams.map((t) => ({ type: 'text', text: String(t) })) }] }
        : {}),
    },
  };
  const r = await postMessage(phoneNumberId, body);
  if (r.networkError) console.error('[whatsapp] send error', r.networkError);
  else if (!r.ok) console.error('[whatsapp] send failed', r.status, JSON.stringify(r.json ?? null).slice(0, 500));
  await logOut({
    to_phone: to,
    template_name: template,
    meta_message_id: messageIdOf(r.json),
    status: r.ok ? 'sent' : 'failed',
    request: body,
    response: r.networkError ? { error: String(r.networkError) } : r.json,
    phone_number_id: phoneNumberId,
    source: 'site',
    kind: 'template',
    body: null,
    sent_by: null,
  });
  return r.ok;
}

// Free-text message (a founder's reply from /admin/whatsapp). Meta only delivers free
// text inside the 24h customer-service window — the caller checks that first. Sends
// from `phoneNumberId` (the number the customer wrote to), else WHATSAPP_PHONE_NUMBER_ID.
// Doesn't log to the store: the admin API does that, with sent_by. Never throws.
export async function sendText(
  toPhone: string,
  text: string,
  phoneNumberId?: string | null,
): Promise<{ ok: boolean; messageId: string | null; phoneNumberId: string | null; request: unknown; response: unknown; error: string | null }> {
  const from = phoneNumberId || env('WHATSAPP_PHONE_NUMBER_ID') || null;
  const fail = (error: string, request: unknown = null, response: unknown = null) =>
    ({ ok: false, messageId: null, phoneNumberId: from, request, response, error });
  if (!env('WHATSAPP_TOKEN') || !from) return fail('WhatsApp is not set up');
  const to = waNumber(toPhone);
  if (to.length < 11) return fail('No valid WhatsApp number');
  const msg = String(text ?? '').trim();
  if (!msg) return fail('Message is empty');
  if (msg.length > 4096) return fail('Message is too long (WhatsApp allows 4096 characters)');
  const body = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'text',
    text: { body: msg, preview_url: true },
  };
  const r = await postMessage(from, body);
  if (r.networkError) {
    const timedOut = (r.networkError as { name?: string }).name === 'AbortError';
    return fail(timedOut
      ? "WhatsApp didn't answer in time. Refresh to check it wasn't sent before trying again."
      : 'Could not reach WhatsApp. Try again.', body, { error: String(r.networkError) });
  }
  if (!r.ok) return fail(metaError(r.json, r.status), body, r.json);
  return { ok: true, messageId: messageIdOf(r.json), phoneNumberId: from, request: body, response: r.json, error: null };
}

// POST a message body to Meta with a 10s cap, reading Meta's JSON reply whether the
// call succeeded or not. Never throws: a network error / timeout comes back as networkError.
async function postMessage(phoneNumberId: string, body: unknown): Promise<{
  ok: boolean; status: number; json: unknown; networkError: unknown;
}> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 10000); // never stall a checkout on WhatsApp
  try {
    const res = await fetch(`${GRAPH}/${phoneNumberId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${env('WHATSAPP_TOKEN')}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    const json = await res.json().catch(() => null);
    return { ok: res.ok, status: res.status, json, networkError: null };
  } catch (e) {
    return { ok: false, status: 0, json: null, networkError: e ?? new Error('fetch failed') };
  } finally {
    clearTimeout(t);
  }
}

// The wamid from Meta's send reply, if any.
function messageIdOf(json: unknown): string | null {
  const id = (json as { messages?: Array<{ id?: unknown }> } | null)?.messages?.[0]?.id;
  return typeof id === 'string' && id ? id : null;
}

// Meta's error reply → one plain-English line for the inbox composer.
function metaError(json: unknown, status: number): string {
  const err = (json as { error?: { code?: number; message?: string; error_data?: { details?: string } } } | null)?.error;
  if (err?.code === 131047) {
    return 'More than 24 hours since they last wrote. WhatsApp only allows an approved template now.';
  }
  return err?.error_data?.details || err?.message || `WhatsApp rejected the message (HTTP ${status})`;
}

// Best-effort messages_out log. The store never throws, but guard anyway: a logging
// problem must never turn a send into a failure.
async function logOut(row: WaOutRow): Promise<void> {
  try {
    if (waStoreConfigured()) await insertOut(row);
  } catch { /* best-effort */ }
}

// Run `fn` at most once per `key`, ever, across cron re-runs. Claims an atomic lock
// (`wa_sent/{key}` via create(), which fails if it exists), runs, and RELEASES the
// lock if the send failed so a later run can retry. Returns whether a message went out.
export async function once(key: string, fn: () => Promise<boolean>): Promise<boolean> {
  const db = adminDb();
  if (!db) return false; // no store → can't dedupe → don't risk spamming
  const ref = db.collection('wa_sent').doc(key);
  try {
    await ref.create({ at: new Date().toISOString() });
  } catch {
    return false; // already claimed (or a write error) → treat as already handled
  }
  const ok = await fn();
  if (!ok) { try { await ref.delete(); } catch { /* leave the claim; a retry is harmless */ } }
  return ok;
}
