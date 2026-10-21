// WhatsApp from the website: ONLY a founder's free-text reply from /admin/whatsapp
// (sendText), which Meta allows inside the customer's 24h window. Every template message
// — order confirmed / shipped / cancelled / refund and the abandoned-cart reminder — is
// sent by the Supabase service (whatsapp/), so there's one system sending them.
// Never throws, so a messaging failure can't break the inbox.

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
