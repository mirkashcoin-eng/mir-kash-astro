// Pure helpers for the WhatsApp inbox: parse Meta's webhook, verify its signature,
// render a sent template as the customer saw it, the 24h reply window, ticks and
// one-line previews. No I/O, so it is unit-tested in whatsapp-inbox.test.mjs.
// Runs in Node and in Vercel functions: Web Crypto only, nothing from node:crypto.
import type { ParsedWebhook, WaContactRow, WaInboundRow, WaKind, WaStatusRow, WaTick } from './whatsapp-types';

export const WINDOW_MS = 24 * 3600e3;

// Body text of every template we send, {{n}} placeholders intact.
// The five order templates are copied from whatsapp/templates/TEMPLATES.md (what the
// Supabase service sends). wa-setup.ts files an older, differently worded
// order_confirmed for the site; we show the TEMPLATES.md wording because the Supabase
// service sends most of the messages. cart_reminder comes from wa-setup.ts.
export const TEMPLATE_TEXT: Record<string, string> = {
  order_confirmed:
    'Hi {{1}}, your Mir Kash order is confirmed.\n'
    + 'Order #{{2}} — {{3}}\n'
    + '\n'
    + "We're getting it ready with care. You'll hear from us again the moment it ships.",
  cod_confirmation:
    "Hi {{1}}, we've received your Cash-on-Delivery order #{{2}} ({{3}}).\n"
    + '\n'
    + "To confirm, reply YES. If you didn't place this order, reply NO.",
  order_shipped:
    'Good news, {{1}} — your order is on its way.\n'
    + 'Order #{{2}} has shipped and should arrive within 5–7 business days.\n'
    + '\n'
    + 'Track it here: {{3}}\n'
    + '\n'
    + 'Thank you for shopping with Mir Kash.',
  order_cancelled:
    'Hi {{1}}, order #{{2}} has been cancelled.\n'
    + 'Reason: {{3}}\n'
    + '\n'
    + 'If you paid online, your refund will reflect within {{4}} business days.',
  refund_processed:
    'Hi {{1}}, your refund for order #{{2}} of {{3}} has been processed.\n'
    + '\n'
    + 'It should reflect in your account within {{4}} business days.',
  cart_reminder:
    'Hi {{1}}, you left something beautiful in your bag at Mir Kash. Complete your order here: https://mirkash.com/shop',
  hello_world: 'Hello World',
};

// ── small readers (never throw on odd input) ────────────────────────────────────

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | null => (v && typeof v === 'object' && !Array.isArray(v) ? v as Obj : null);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
// A non-empty string, else null.
const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
const digits = (v: unknown): string => (typeof v === 'string' || typeof v === 'number' ? String(v).replace(/\D/g, '') : '');
// Meta's unix-seconds timestamp ("1729500000") → ISO, or null when it isn't one.
const unixIso = (v: unknown): string | null => {
  const s = typeof v === 'number' ? v : typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : NaN;
  if (!Number.isFinite(s)) return null;
  const d = new Date(s * 1000);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

const MEDIA_KINDS = new Set(['image', 'video', 'audio', 'document', 'sticker']);
const STATUSES = new Set(['sent', 'delivered', 'read', 'failed']);

// One Meta message object → a messages_in row, or null when it's malformed.
function inboundRow(m: Obj, phoneNumberId: string | null): WaInboundRow | null {
  const id = str(m.id);
  const from = digits(m.from);
  const at = unixIso(m.timestamp);
  if (!id || !from || !at) return null;
  const type = typeof m.type === 'string' ? m.type : '';
  let kind: WaInboundRow['kind'] = 'unsupported';
  let body: string | null = null;
  let mediaId: string | null = null;
  let mediaMime: string | null = null;

  if (type === 'text') {
    kind = 'text';
    body = str(obj(m.text)?.body);
  } else if (MEDIA_KINDS.has(type) || type === 'voice') {
    kind = type === 'voice' ? 'audio' : type as WaInboundRow['kind'];
    const media = obj(m[type]);
    mediaId = str(media?.id);
    mediaMime = str(media?.mime_type);
    body = str(media?.caption) ?? (type === 'document' ? str(media?.filename) : null);
  } else if (type === 'button') {
    kind = 'button';
    body = str(obj(m.button)?.text);
  } else if (type === 'interactive') {
    kind = 'button';
    const ia = obj(m.interactive);
    body = str(obj(ia?.button_reply)?.title) ?? str(obj(ia?.list_reply)?.title);
  } else if (type === 'reaction') {
    kind = 'reaction';
    body = str(obj(m.reaction)?.emoji);
  } else if (type === 'location') {
    kind = 'location';
    const loc = obj(m.location);
    const lat = loc?.latitude, lng = loc?.longitude;
    body = str(loc?.name) ?? str(loc?.address)
      ?? ((typeof lat === 'number' || typeof lat === 'string') && (typeof lng === 'number' || typeof lng === 'string')
        ? `${lat},${lng}` : null);
  }

  return {
    meta_message_id: id,
    from_phone: from,
    phone_number_id: phoneNumberId,
    kind,
    body,
    media_id: mediaId,
    media_mime: mediaMime,
    reply_to: str(obj(m.context)?.id),
    received_at: at,
    raw: m,
  };
}

// One Meta status object → a message_status row, or null when it's malformed or a
// status we don't track (e.g. "deleted").
function statusRow(s: Obj, phoneNumberId: string | null): WaStatusRow | null {
  const id = str(s.id);
  const to = digits(s.recipient_id);
  const status = typeof s.status === 'string' ? s.status : '';
  const at = unixIso(s.timestamp);
  if (!id || !to || !at || !STATUSES.has(status)) return null;
  const e = obj(arr(s.errors)[0]);
  const error = e ? (str(obj(e.error_data)?.details) ?? str(e.message) ?? str(e.title)) : null;
  return {
    meta_message_id: id,
    recipient_phone: to,
    phone_number_id: phoneNumberId,
    status: status as WaStatusRow['status'],
    at,
    error,
  };
}

// Meta webhook body → rows to store. Ignores anything it doesn't recognise; never throws.
export function parseWebhook(body: unknown): ParsedWebhook {
  const out: ParsedWebhook = { inbound: [], statuses: [], contacts: [] };
  try {
    for (const entry of arr(obj(body)?.entry)) {
      for (const change of arr(obj(entry)?.changes)) {
        const c = obj(change);
        if (!c || c.field !== 'messages') continue;
        const value = obj(c.value);
        if (!value) continue;
        const phoneNumberId = str(obj(value.metadata)?.phone_number_id);
        for (const m of arr(value.messages)) {
          const o = obj(m);
          const row = o && inboundRow(o, phoneNumberId);
          if (row) out.inbound.push(row);
        }
        for (const s of arr(value.statuses)) {
          const o = obj(s);
          const row = o && statusRow(o, phoneNumberId);
          if (row) out.statuses.push(row);
        }
        for (const ct of arr(value.contacts)) {
          const o = obj(ct);
          const phone = digits(o?.wa_id);
          if (!phone) continue;
          const contact: WaContactRow = { phone, profile_name: str(obj(o?.profile)?.name) };
          out.contacts.push(contact);
        }
      }
    }
  } catch {
    // Unreachable in practice (every read above is guarded); keep whatever parsed.
  }
  return out;
}

// X-Hub-Signature-256 ("sha256=<hex>") over the RAW body with the Meta app secret.
// Web Crypto; constant-time compare. False on a missing header or secret.
export async function verifySignature(rawBody: string, header: string | null, appSecret: string): Promise<boolean> {
  if (!header || !appSecret || typeof rawBody !== 'string') return false;
  const h = header.trim();
  if (!h.startsWith('sha256=')) return false;
  const given = h.slice(7).toLowerCase();
  try {
    const enc = new TextEncoder();
    const key = await globalThis.crypto.subtle.importKey(
      'raw', enc.encode(appSecret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
    );
    const sig = new Uint8Array(await globalThis.crypto.subtle.sign('HMAC', key, enc.encode(rawBody)));
    const expected = Array.from(sig, (b) => b.toString(16).padStart(2, '0')).join('');
    if (given.length !== expected.length) return false;
    let diff = 0;
    for (let i = 0; i < expected.length; i++) diff |= given.charCodeAt(i) ^ expected.charCodeAt(i);
    return diff === 0;
  } catch {
    return false;
  }
}

// The body-parameter texts from a messages_out.request JSON, in order.
export function templateParams(request: unknown): string[] {
  let r = request;
  if (typeof r === 'string') {
    try { r = JSON.parse(r); } catch { return []; }
  }
  const body = arr(obj(obj(r)?.template)?.components)
    .map(obj)
    .find((c) => typeof c?.type === 'string' && c.type.toLowerCase() === 'body');
  if (!body) return [];
  return arr(body.parameters).map((p) => {
    const t = obj(p)?.text;
    return typeof t === 'string' ? t : t == null ? '' : String(t);
  });
}

// Template text with {{n}} filled in; unknown template → "Template: name · p1, p2".
// No name at all (null or empty) → "Template message".
export function renderTemplate(name: string | null, params: string[]): string {
  const ps = Array.isArray(params) ? params : [];
  if (!name || !name.trim()) return 'Template message';
  if (!Object.prototype.hasOwnProperty.call(TEMPLATE_TEXT, name)) {
    return ps.length ? `Template: ${name} · ${ps.join(', ')}` : `Template: ${name}`;
  }
  return TEMPLATE_TEXT[name].replace(/\{\{(\d+)\}\}/g, (whole, n: string) => {
    const v = ps[Number(n) - 1];
    return v == null ? whole : String(v);
  });
}

export function windowOpen(lastInboundAt: string | null, now: number = Date.now()): boolean {
  if (!lastInboundAt) return false;
  const t = Date.parse(lastInboundAt);
  return Number.isFinite(t) && now - t < WINDOW_MS;
}

export function windowClosesAt(lastInboundAt: string | null): string | null {
  if (!lastInboundAt) return null;
  const t = Date.parse(lastInboundAt);
  return Number.isFinite(t) ? new Date(t + WINDOW_MS).toISOString() : null;
}

// Outbound tick from the send result and receipts: failed > read > delivered > sent.
export function tickFor(m: {
  send_status: 'sent' | 'failed' | null; delivered_at: string | null; read_at: string | null; failed_at: string | null;
}): WaTick {
  if (m.send_status === 'failed' || m.failed_at) return 'failed';
  if (m.read_at) return 'read';
  if (m.delivered_at) return 'delivered';
  return 'sent';
}

const PREVIEW_MAX = 120;

// One-line preview for the thread list: template text, body, or "📷 Photo" etc.
// Whitespace collapsed to single spaces, at most 120 characters (ending in "…" when cut).
export function previewOf(kind: WaKind, body: string | null, template: string | null, request: unknown): string {
  const b = typeof body === 'string' ? body.trim() : '';
  let s: string;
  switch (kind) {
    case 'template': s = renderTemplate(template, templateParams(request)); break;
    case 'text':
    case 'button': s = b; break;
    case 'image': s = b ? `📷 ${b}` : '📷 Photo'; break;
    case 'video': s = b ? `🎥 ${b}` : '🎥 Video'; break;
    case 'audio': s = '🎤 Voice message'; break;
    case 'document': s = `📄 ${b || 'Document'}`; break;
    case 'sticker': s = 'Sticker'; break;
    case 'location': s = '📍 Location'; break;
    case 'reaction': s = b ? `Reacted ${b}` : 'Reacted'; break;
    default: s = 'Unsupported message';
  }
  s = s.replace(/\s+/g, ' ').trim();
  // Count code points, so an emoji is never cut in half.
  const chars = Array.from(s);
  return chars.length > PREVIEW_MAX ? chars.slice(0, PREVIEW_MAX - 1).join('').trimEnd() + '…' : s;
}
