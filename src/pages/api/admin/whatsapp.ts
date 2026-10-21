import type { APIRoute } from 'astro';
import { requestIsAdmin } from '~/lib/adminAuth';
import { verifyFirebaseUser } from '~/lib/firebaseAuth';
import { q } from '~/lib/db';
import { personKey } from '~/lib/events';
import { sendText, waNumber } from '~/lib/whatsapp';
import {
  insertOut, lastInbound, listMessageRows, listThreadRows, markRead, waStoreConfigured,
} from '~/lib/whatsapp-store';
import { previewOf, renderTemplate, templateParams, tickFor, windowClosesAt, windowOpen } from '~/lib/whatsapp-inbox';
import type {
  WaFilter, WaMessage, WaMessageRow, WaSendResponse, WaThread, WaThreadResponse, WaThreadRow, WaThreadsResponse,
} from '~/lib/whatsapp-types';

export const prerender = false;

// Founders-only WhatsApp inbox API behind /admin/whatsapp. All WhatsApp data lives in
// the WhatsApp service's Supabase (whatsapp-store.ts); Neon is only read for People
// names. Loaded on page open / conversation open / after a send / on Refresh — the
// page never polls.
//
// GET ?view=threads&q=&filter=all|replied|unread&before=
//     → WaThreadsResponse: conversations, most recent first, 50 a page.
// GET ?view=thread&phone=&before=
//     → WaThreadResponse: up to 100 messages oldest first, the 24h reply window, and
//       (first page only) marks the conversation read.
// GET ?view=media&id=
//     → the photo / voice note / document bytes, fetched from Meta with our token.
// POST { phone, text }
//     → WaSendResponse: a free-text reply, only inside the 24h window, sent from the
//       number the customer last wrote to and logged to messages_out (source 'inbox').
// Store not set up → { configured:false } with empty lists, never an error.
const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex, nofollow' },
  });

function env(k: string): string {
  if (typeof process !== 'undefined' && process.env && process.env[k]) return process.env[k] as string;
  const m = import.meta.env as Record<string, string | undefined>;
  return m[k] ?? '';
}

const GRAPH = 'https://graph.facebook.com/v21.0';
const THREADS_PAGE = 50;
const MESSAGES_PAGE = 100;
const MAX_TEXT = 4096; // Meta's limit for a text message body

const FILTERS: WaFilter[] = ['all', 'replied', 'unread'];
// An ISO-ish cursor from the page, or null. Anything unparseable is ignored.
const cursor = (v: string | null): string | null => (v && v.length <= 40 && !Number.isNaN(Date.parse(v)) ? v : null);

// ── Names ────────────────────────────────────────────────────────────────────

// Neon people names + ids for a set of phones, keyed by personKey (last 10 digits).
// One query; Neon down or unset → an empty map (names just fall through).
async function peopleFor(phones: string[]): Promise<Map<string, { person_id: string; name: string | null }>> {
  const keys = [...new Set(phones.map((p) => personKey(p)).filter(Boolean))];
  const out = new Map<string, { person_id: string; name: string | null }>();
  if (!keys.length) return out;
  const rows = await q<{ person_id: string; name: string | null }>(
    'SELECT person_id, name FROM people WHERE person_id = ANY($1)', [keys],
  );
  for (const r of rows ?? []) out.set(r.person_id, { person_id: r.person_id, name: r.name?.trim() || null });
  return out;
}

// WhatsApp profile name → People name → the first name we put in the last template's
// {{1}} (skipping our 'there' fallback) → null.
function nameFor(
  t: { profile_name: string | null; last_direction: string | null; last_request: unknown },
  person: { name: string | null } | undefined,
): string | null {
  if (t.profile_name?.trim()) return t.profile_name.trim();
  if (person?.name) return person.name;
  if (t.last_direction === 'out') {
    const first = (templateParams(t.last_request)[0] || '').trim().split(/\s+/)[0] || '';
    if (first && first.toLowerCase() !== 'there') return first;
  }
  return null;
}

// ── Mapping ──────────────────────────────────────────────────────────────────

// Meta's reason from a failed send's stored response: { error: { message,
// error_data: { details } } }, or our own { error: '...' }.
function sendErrorText(e: unknown): string | null {
  if (!e || typeof e !== 'object') return null;
  const err = (e as { error?: unknown }).error;
  if (typeof err === 'string') return err.slice(0, 300) || null;
  if (err && typeof err === 'object') {
    const o = err as { message?: unknown; error_data?: { details?: unknown } };
    const s = o.error_data?.details ?? o.message;
    return typeof s === 'string' && s.trim() ? s.trim().slice(0, 300) : null;
  }
  return null;
}

function toMessage(r: WaMessageRow): WaMessage {
  const out = r.direction === 'out';
  return {
    id: r.id,
    direction: r.direction,
    kind: r.kind,
    source: r.source,
    template: r.template_name,
    text: r.kind === 'template' ? renderTemplate(r.template_name, templateParams(r.request)) : r.body,
    media_id: r.media_id,
    media_mime: r.media_mime,
    reply_to: r.reply_to,
    sent_by: r.sent_by,
    at: r.at,
    tick: out ? tickFor(r) : null,
    failed_reason: out ? r.failed_reason || (r.send_status === 'failed' ? sendErrorText(r.send_error) : null) : null,
  };
}

function toThread(r: WaThreadRow, person: { person_id: string; name: string | null } | undefined): WaThread {
  const preview = previewOf(r.last_kind, r.last_body, r.last_template, r.last_request);
  return {
    phone: r.phone,
    name: nameFor(r, person),
    person_id: person?.person_id ?? null,
    last_at: r.last_at,
    last_direction: r.last_direction,
    last_preview: r.last_direction === 'out' && r.last_kind !== 'template' ? `You: ${preview}` : preview,
    last_inbound_at: r.last_inbound_at,
    unread: Number(r.unread) || 0,
    window_open: windowOpen(r.last_inbound_at),
  };
}

// ── GET ──────────────────────────────────────────────────────────────────────

async function threads(url: URL): Promise<Response> {
  const as_of = new Date().toISOString();
  if (!waStoreConfigured()) return json({ configured: false, as_of, threads: [], next_before: null } satisfies WaThreadsResponse);

  const filterParam = (url.searchParams.get('filter') || 'all') as WaFilter;
  const rows = await listThreadRows({
    q: (url.searchParams.get('q') || '').trim().slice(0, 100) || undefined,
    filter: FILTERS.includes(filterParam) ? filterParam : 'all',
    before: cursor(url.searchParams.get('before')),
    limit: THREADS_PAGE,
  });
  if (!rows) return json({ error: "Couldn't load conversations" }, 502);

  const people = await peopleFor(rows.map((r) => r.phone));
  const body: WaThreadsResponse = {
    configured: true,
    as_of,
    threads: rows.map((r) => toThread(r, people.get(personKey(r.phone)))),
    next_before: rows.length >= THREADS_PAGE ? rows[rows.length - 1].last_at : null,
  };
  return json(body);
}

async function thread(url: URL): Promise<Response> {
  const phone = waNumber(url.searchParams.get('phone'));
  if (phone.length < 11 || phone.length > 15) return json({ error: 'A phone number with country code is required' }, 400);
  const before = cursor(url.searchParams.get('before'));

  if (!waStoreConfigured()) {
    return json({
      configured: false, phone, name: null, person_id: null, messages: [],
      window_open: false, window_closes_at: null, last_inbound_at: null, next_before: null,
    } satisfies WaThreadResponse);
  }

  // The thread row only supplies the profile name; `q` is a contains-match, so ask for
  // a few and take the exact phone.
  const [rows, last, threadRows, people] = await Promise.all([
    listMessageRows(phone, { before, limit: MESSAGES_PAGE }),
    lastInbound(phone),
    listThreadRows({ q: phone, limit: 5 }),
    peopleFor([phone]),
  ]);
  if (!rows) return json({ error: "Couldn't load messages" }, 502);

  // Rows come newest first. Without a thread row, the newest message stands in for it.
  const t = threadRows?.find((r) => r.phone === phone);
  const newest = rows[0];
  const person = people.get(personKey(phone));
  const name = nameFor(
    t ?? { profile_name: null, last_direction: newest?.direction ?? null, last_request: newest?.request ?? null },
    person,
  );

  if (!before) await markRead(phone); // first page = the conversation was opened

  const lastAt = last?.at ?? null;
  const body: WaThreadResponse = {
    configured: true,
    phone,
    name,
    person_id: person?.person_id ?? null,
    messages: rows.map(toMessage).reverse(),
    window_open: windowOpen(lastAt),
    window_closes_at: windowClosesAt(lastAt),
    last_inbound_at: lastAt,
    next_before: rows.length >= MESSAGES_PAGE ? rows[rows.length - 1].at : null,
  };
  return json(body);
}

// fetch with a 10s limit on getting the response headers (the body of a large video
// is allowed to keep streaming). Never throws: network error / timeout → null.
async function fetch10s(u: string, init: RequestInit): Promise<Response | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 10000);
  try {
    return await fetch(u, { ...init, signal: ctrl.signal });
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

async function media(url: URL): Promise<Response> {
  const id = url.searchParams.get('id') || '';
  if (!/^\d{1,30}$/.test(id)) return json({ error: 'Bad media id' }, 400);
  const token = env('WHATSAPP_TOKEN');
  if (!token) return json({ error: 'Media no longer available' }, 404);
  const gone = () => json({ error: 'Media no longer available' }, 404);
  const auth = { Authorization: `Bearer ${token}` };

  // 1) media id → a short-lived download URL. 2) download it with the same token.
  const meta = await fetch10s(`${GRAPH}/${id}`, { headers: auth });
  if (!meta?.ok) return gone();
  let info: { url?: unknown; mime_type?: unknown };
  try { info = await meta.json(); } catch { return gone(); }
  if (typeof info.url !== 'string' || !/^https:\/\//i.test(info.url)) return gone();

  const file = await fetch10s(info.url, { headers: auth });
  if (!file?.ok || !file.body) return gone();

  const mime = typeof info.mime_type === 'string' && /^[\w.+-]+\/[\w.+-]+/.test(info.mime_type)
    ? info.mime_type.split(';')[0].trim()
    : 'application/octet-stream';
  const headers: Record<string, string> = {
    'Content-Type': mime,
    'Cache-Control': 'private, max-age=3600',
    'X-Robots-Tag': 'noindex, nofollow',
    // A customer's document is never run as a page on our origin.
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': 'sandbox',
  };
  const len = file.headers.get('content-length');
  if (len) headers['Content-Length'] = len;
  return new Response(file.body, { status: 200, headers });
}

export const GET: APIRoute = async ({ request, url }) => {
  if (!(await requestIsAdmin(request))) return json({ error: 'Not authorised' }, 401);
  try {
    const view = url.searchParams.get('view') || 'threads';
    if (view === 'threads') return await threads(url);
    if (view === 'thread') return await thread(url);
    if (view === 'media') return await media(url);
    return json({ error: 'Unknown view' }, 400);
  } catch (e) {
    // The store, Neon and Meta helpers never throw; this is only a backstop.
    console.error('[admin/whatsapp] GET failed:', e);
    return json({ error: 'Something went wrong' }, 502);
  }
};

// ── POST: reply ──────────────────────────────────────────────────────────────

export const POST: APIRoute = async ({ request }) => {
  if (!(await requestIsAdmin(request))) return json({ error: 'Not authorised' }, 401);

  let body: { phone?: unknown; text?: unknown };
  try { body = await request.json(); } catch { return json({ ok: false, error: 'Bad request' } satisfies WaSendResponse, 400); }
  const phone = waNumber(typeof body.phone === 'string' || typeof body.phone === 'number' ? String(body.phone) : '');
  if (phone.length < 11 || phone.length > 15) return json({ ok: false, error: 'A phone number with country code is required' } satisfies WaSendResponse, 400);
  const text = typeof body.text === 'string' ? body.text.trim() : '';
  if (!text) return json({ ok: false, error: 'Type a message first.' } satisfies WaSendResponse, 400);
  if (text.length > MAX_TEXT) return json({ ok: false, error: `Too long — WhatsApp allows ${MAX_TEXT} characters.` } satisfies WaSendResponse, 400);

  if (!waStoreConfigured()) return json({ ok: false, error: "The WhatsApp inbox isn't set up yet." } satisfies WaSendResponse, 503);

  try {
    // Who sent it (requestIsAdmin already verified this token is a full founder).
    const token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
    const [user, last] = await Promise.all([verifyFirebaseUser(token), lastInbound(phone)]);
    const sent_by = user?.email ? user.email.toLowerCase() : null;

    // The page checks this too; Meta would reject free text outside the window anyway.
    if (!last || !windowOpen(last.at)) {
      return json({ ok: false, error: 'More than 24 hours since they last wrote. WhatsApp only allows an approved template now.' } satisfies WaSendResponse, 409);
    }

    const r = await sendText(phone, text, last.phone_number_id);
    await insertOut({
      to_phone: phone,
      template_name: null,
      meta_message_id: r.messageId,
      status: r.ok ? 'sent' : 'failed',
      request: r.request,
      response: r.response,
      phone_number_id: r.phoneNumberId,
      source: 'inbox',
      kind: 'text',
      body: text,
      sent_by,
    });

    if (!r.ok) return json({ ok: false, error: r.error || "Couldn't send. Try again." } satisfies WaSendResponse, 502);

    const message: WaMessage = {
      id: r.messageId || `out:${Date.now()}`,
      direction: 'out',
      kind: 'text',
      source: 'inbox',
      template: null,
      text,
      media_id: null,
      media_mime: null,
      reply_to: null,
      sent_by,
      at: new Date().toISOString(),
      tick: 'sent',
      failed_reason: null,
    };
    return json({ ok: true, message } satisfies WaSendResponse);
  } catch (e) {
    console.error('[admin/whatsapp] send failed:', e);
    return json({ ok: false, error: "Couldn't send. Try again." } satisfies WaSendResponse, 502);
  }
};
