// WhatsApp inbox store — Supabase (the WhatsApp service's own project), over its
// PostgREST API with the service-role key. Server-only. Never throws: every call
// returns null/false when the store isn't configured or a request fails (logged).
//
// Schema: whatsapp/supabase/migrations/0003_inbox.sql (messages_in, message_status,
// wa_contacts, the wa_messages / wa_threads views, upsert_wa_statuses()). Plain fetch,
// no supabase-js, so there's no new dependency.
import type {
  WaContactRow, WaFilter, WaInboundRow, WaMessageRow, WaOutRow, WaStatusRow, WaThreadRow,
} from './whatsapp-types';

function env(k: string): string {
  if (typeof process !== 'undefined' && process.env && process.env[k]) return process.env[k] as string;
  const m = import.meta.env as Record<string, string | undefined>;
  return m[k] ?? '';
}

// WA_SUPABASE_URL + WA_SUPABASE_SERVICE_KEY are both set.
export function waStoreConfigured(): boolean {
  return Boolean(env('WA_SUPABASE_URL').trim() && env('WA_SUPABASE_SERVICE_KEY').trim());
}

// Phones are digits only (see whatsapp-types.ts); strip anything else before it can
// reach a URL or a primary key.
const digits = (s: string | null | undefined) => String(s ?? '').replace(/[^0-9]/g, '');

const clamp = (n: number | undefined, def: number, max: number) =>
  Math.min(max, Math.max(1, Math.floor(Number(n) || def)));

// An ISO cursor, passed through as-is (not re-serialised: Postgres keeps microseconds,
// and rounding to ms would skip rows that fall inside the lost precision).
function cursor(s: string | null | undefined): string | null {
  const v = String(s ?? '').trim();
  return v && v.length <= 40 && !Number.isNaN(Date.parse(v)) ? v : null;
}

type Query = Array<[string, string]>;

// One PostgREST request. Returns the parsed JSON body (null for an empty body), or
// undefined when the request failed (logged) — so callers can tell "failed" from "no rows".
async function rest(
  method: 'GET' | 'POST',
  path: string,
  query: Query = [],
  body?: unknown,
  prefer?: string,
): Promise<unknown | undefined> {
  const base = env('WA_SUPABASE_URL').trim().replace(/\/+$/, '');
  const key = env('WA_SUPABASE_SERVICE_KEY').trim();
  const qs = query.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
  const url = `${base}/rest/v1/${path}${qs ? `?${qs}` : ''}`;
  const headers: Record<string, string> = { apikey: key, Authorization: `Bearer ${key}` };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (prefer) headers.Prefer = prefer;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 10000);
  try {
    const res = await fetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ctrl.signal,
    });
    const text = await res.text().catch(() => '');
    if (!res.ok) {
      console.error(`[wa-store] ${method} ${path} failed`, res.status, text.slice(0, 300));
      return undefined;
    }
    return text ? JSON.parse(text) : null;
  } catch (e) {
    console.error(`[wa-store] ${method} ${path} error`, e);
    return undefined;
  } finally {
    clearTimeout(t);
  }
}

// A write: true on 2xx. return=minimal so PostgREST doesn't echo the rows back.
async function write(path: string, body: unknown, prefer: string[] = [], query: Query = []): Promise<boolean> {
  const r = await rest('POST', path, query, body, ['return=minimal', ...prefer].join(','));
  return r !== undefined;
}

// Threads, most recent activity first. `q` matches phone / profile name / last body;
// `before` is an ISO last_at cursor (exclusive). Default limit 50.
export async function listThreadRows(opts: {
  q?: string; filter?: WaFilter; before?: string | null; limit?: number;
} = {}): Promise<WaThreadRow[] | null> {
  if (!waStoreConfigured()) return null;
  const query: Query = [
    ['select', '*'],
    ['order', 'last_at.desc'],
    ['limit', String(clamp(opts.limit, 50, 200))],
  ];
  const before = cursor(opts.before);
  if (before) query.push(['last_at', `lt.${before}`]);
  if (opts.filter === 'replied') query.push(['last_inbound_at', 'not.is.null']);
  else if (opts.filter === 'unread') query.push(['unread', 'gt.0']);
  // Search: values inside or=(…) are unquoted, so strip the characters PostgREST treats
  // as syntax there (, ( ) and the * wildcard), plus " and \ which would start quoting.
  const q = String(opts.q ?? '').trim().slice(0, 60).replace(/[,()*"\\]/g, '').trim();
  if (q) {
    const d = digits(q);
    const phone = d.length >= 3 ? d : q; // "+91 98765" → 9198765 against the digits-only phone
    query.push(['or', `(phone.ilike.*${phone}*,profile_name.ilike.*${q}*,last_body.ilike.*${q}*)`]);
  }
  const r = await rest('GET', 'wa_threads', query);
  return Array.isArray(r) ? (r as WaThreadRow[]) : null;
}

// Messages for one phone, NEWEST first (the API reverses them). `before` = ISO `at`
// cursor (exclusive). Default limit 100.
export async function listMessageRows(phone: string, opts: {
  before?: string | null; limit?: number;
} = {}): Promise<WaMessageRow[] | null> {
  if (!waStoreConfigured()) return null;
  const p = digits(phone);
  if (!p) return [];
  const query: Query = [
    ['phone', `eq.${p}`],
    ['order', 'at.desc,id.desc'], // id breaks ties so pages are stable
    ['limit', String(clamp(opts.limit, 100, 500))],
  ];
  const before = cursor(opts.before);
  if (before) query.push(['at', `lt.${before}`]);
  const r = await rest('GET', 'wa_messages', query);
  return Array.isArray(r) ? (r as WaMessageRow[]) : null;
}

// Their most recent inbound message, for the 24h window check and the reply number.
export async function lastInbound(phone: string): Promise<{ at: string; phone_number_id: string | null } | null> {
  if (!waStoreConfigured()) return null;
  const p = digits(phone);
  if (!p) return null;
  const r = await rest('GET', 'messages_in', [
    ['from_phone', `eq.${p}`],
    ['select', 'received_at,phone_number_id'],
    ['order', 'received_at.desc'],
    ['limit', '1'],
  ]);
  const row = Array.isArray(r) ? (r[0] as { received_at?: string; phone_number_id?: string | null } | undefined) : undefined;
  return row?.received_at ? { at: row.received_at, phone_number_id: row.phone_number_id ?? null } : null;
}

// Upsert wa_contacts.last_read_at = now() for the phone.
export async function markRead(phone: string): Promise<boolean> {
  if (!waStoreConfigured()) return false;
  const p = digits(phone);
  if (!p) return false;
  const now = new Date().toISOString();
  // merge-duplicates only sets the columns in the body, so profile_name is left alone.
  return write('wa_contacts', { phone: p, last_read_at: now, updated_at: now }, ['resolution=merge-duplicates']);
}

export async function insertOut(row: WaOutRow): Promise<boolean> {
  if (!waStoreConfigured()) return false;
  const body: Record<string, unknown> = { ...row, to_phone: digits(row.to_phone) };
  for (const k of Object.keys(body)) if (body[k] === undefined) delete body[k];
  return write('messages_out', body);
}

// Insert, ignoring duplicates on meta_message_id.
export async function upsertInbound(rows: WaInboundRow[]): Promise<boolean> {
  if (!waStoreConfigured()) return false;
  if (!rows.length) return true;
  const body = rows.map((r) => ({ ...r, from_phone: digits(r.from_phone) }));
  return write('messages_in', body, ['resolution=ignore-duplicates'], [['on_conflict', 'meta_message_id']]);
}

// Merge receipts into message_status: each timestamp column is only ever set, never
// cleared or moved later (receipts arrive out of order).
export async function upsertStatuses(rows: WaStatusRow[]): Promise<boolean> {
  if (!waStoreConfigured()) return false;
  if (!rows.length) return true;
  // The merge rules live in upsert_wa_statuses() (0003_inbox.sql) — one call per batch.
  const body = rows.map((r) => ({ ...r, recipient_phone: digits(r.recipient_phone) }));
  const r = await rest('POST', 'rpc/upsert_wa_statuses', [], { rows: body });
  return r !== undefined;
}

// Upsert profile names; a null name never overwrites a known one.
export async function upsertContacts(rows: WaContactRow[]): Promise<boolean> {
  if (!waStoreConfigured()) return false;
  // Rows without a name are dropped, so a known name is never cleared and last_read_at
  // is never touched. One row per phone (last wins): a batch upsert can't hit the same
  // key twice.
  const now = new Date().toISOString();
  const byPhone = new Map<string, { phone: string; profile_name: string; updated_at: string }>();
  for (const r of rows) {
    const p = digits(r.phone);
    const name = r.profile_name?.trim();
    if (p && name) byPhone.set(p, { phone: p, profile_name: name, updated_at: now });
  }
  if (!byPhone.size) return true;
  return write('wa_contacts', [...byPhone.values()], ['resolution=merge-duplicates']);
}
