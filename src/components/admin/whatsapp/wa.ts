// Client for /admin/whatsapp: sign-in gate, conversation list, chat, composer and media.
// Data loads when the page opens, when a conversation is opened, after a send and on
// Refresh (button or pull-down; reloads the list and the open chat). Nothing polls, and there's no focus/visibility refetch
// or realtime (see admin-no-polling). Response shapes: src/lib/whatsapp-types.ts.
//
// ?demo=1 on the dev server skips sign-in and serves fixtures.ts through the same
// functions, so demo mode runs exactly the rendering code real mode runs.
import { getIdToken, getSessionUser, signInWithGoogle, signOut } from '~/lib/firebaseClient';
import type {
  WaFilter, WaMessage, WaSendResponse, WaThread, WaThreadResponse, WaThreadsResponse,
} from '~/lib/whatsapp-types';
import { esc } from '../format';
import * as fx from './fixtures';

// ── Demo flag (same rule as ../data.ts) ──────────────────────────────────────
// Sample data only renders when asked for. A dev build also skips the sign-in gate;
// in production the gate is untouched and ?demo=1 only swaps the data after sign-in.
const params = new URLSearchParams(location.search);
const DEMO = params.get('demo') === '1';
const DEMO_SKIPS_AUTH = DEMO && import.meta.env.DEV === true;

const API = '/api/admin/whatsapp';
const IST = 'Asia/Kolkata';
const $ = (id: string) => document.getElementById(id) as HTMLElement;
const wide = () => matchMedia('(min-width: 900px)').matches;
const touch = () => matchMedia('(pointer: coarse)').matches;

// ── Transport ────────────────────────────────────────────────────────────────
type Res<T> = { ok: true; status: number; data: T } | { ok: false; status: number; error: string };

async function authHeaders(): Promise<Record<string, string>> {
  let t: string | null = null;
  try { t = await getIdToken(); } catch { /* signed out */ }
  return t ? { Authorization: 'Bearer ' + t } : {};
}

function errText(status: number, body: any): string {
  if (status === 401 || status === 403) return 'Your session has expired. Reload and sign in again.';
  if (status === 404 && !body?.error) return 'The WhatsApp inbox isn’t available on the server yet.';
  return (body?.error ? String(body.error) : 'The server couldn’t load this') + ' (HTTP ' + status + ').';
}

async function call<T>(qs: Record<string, string> | null, body?: unknown): Promise<Res<T>> {
  try {
    const h = await authHeaders();
    const url = qs ? API + '?' + new URLSearchParams(qs).toString() : API;
    const r = await fetch(url, body === undefined ? { headers: h }
      : { method: 'POST', headers: { ...h, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => null);
    if (!r.ok) return { ok: false, status: r.status, error: errText(r.status, j) };
    if (!j) return { ok: false, status: r.status, error: 'The server sent an empty reply.' };
    return { ok: true, status: r.status, data: j as T };
  } catch {
    return { ok: false, status: 0, error: 'Couldn’t reach the server. Check your connection and try again.' };
  }
}

function getThreads(q: string, filter: WaFilter, before: string | null): Promise<Res<WaThreadsResponse>> {
  if (DEMO) return Promise.resolve({ ok: true, status: 200, data: fx.demoThreads({ q, filter, before }) });
  const qs: Record<string, string> = { view: 'threads', filter };
  if (q) qs.q = q;
  if (before) qs.before = before;
  return call<WaThreadsResponse>(qs);
}

function getThread(phone: string, before: string | null): Promise<Res<WaThreadResponse>> {
  if (DEMO) return Promise.resolve({ ok: true, status: 200, data: fx.demoThread(phone, before) });
  const qs: Record<string, string> = { view: 'thread', phone };
  if (before) qs.before = before;
  return call<WaThreadResponse>(qs);
}

async function sendText(phone: string, text: string): Promise<WaSendResponse> {
  if (DEMO) return fx.demoSend(phone, text);
  const r = await call<WaSendResponse>(null, { phone, text });
  if (!r.ok) return { ok: false, error: r.error };
  if (r.data.ok && r.data.message) return r.data;
  return { ok: false, error: r.data.error || 'WhatsApp didn’t accept the message.' };
}

// Photos and voice notes need the bearer token, so they're fetched and shown from a blob URL.
const MEDIA = new Map<string, Promise<string | null>>();
function mediaUrl(id: string, kind: string): Promise<string | null> {
  if (DEMO) return Promise.resolve(fx.demoMediaUrl(id, kind));
  let p = MEDIA.get(id);
  if (!p) {
    p = (async () => {
      try {
        const r = await fetch(API + '?view=media&id=' + encodeURIComponent(id), { headers: await authHeaders() });
        if (!r.ok) return null;
        return URL.createObjectURL(await r.blob());
      } catch { return null; }
    })();
    p.then((u) => { if (!u) MEDIA.delete(id); });
    MEDIA.set(id, p);
  }
  return p;
}

// ── Formatting ───────────────────────────────────────────────────────────────
const dayKey = (ms: number) => new Date(ms).toLocaleDateString('en-CA', { timeZone: IST });
function parts(iso: string): Record<string, string> {
  const o: Record<string, string> = {};
  new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hourCycle: 'h23', timeZone: IST })
    .formatToParts(new Date(iso)).forEach((p) => { o[p.type] = p.value; });
  return o;
}
/** "3:42 pm", IST. */
function clock(iso: string): string {
  const p = parts(iso);
  const h = Number(p.hour) % 24;
  return (h % 12 || 12) + ':' + p.minute + ' ' + (h < 12 ? 'am' : 'pm');
}
/** Date separator: "Today", "Yesterday", "Mon 12 Oct" (with the year when it isn't this year). */
function dayLabel(iso: string, now = Date.now()): string {
  const d = dayKey(new Date(iso).getTime());
  if (d === dayKey(now)) return 'Today';
  if (d === dayKey(now - 864e5)) return 'Yesterday';
  const p = parts(iso);
  return p.weekday + ' ' + p.day + ' ' + p.month + (d.slice(0, 4) === dayKey(now).slice(0, 4) ? '' : ' ' + p.year);
}
/** Conversation list: time today, "Yesterday", weekday this week, else "12 Oct". */
function listTime(iso: string, now = Date.now()): string {
  const t = new Date(iso).getTime();
  if (!isFinite(t)) return '';
  const d = dayKey(t);
  if (d === dayKey(now)) return clock(iso);
  if (d === dayKey(now - 864e5)) return 'Yesterday';
  const p = parts(iso);
  if (now - t < 6 * 864e5) return p.weekday;
  return p.day + ' ' + p.month + (d.slice(0, 4) === dayKey(now).slice(0, 4) ? '' : ' ' + p.year);
}
/** "3 days ago". */
function ago(iso: string, now = Date.now()): string {
  const m = Math.max(0, (now - new Date(iso).getTime()) / 60e3);
  const unit = (n: number, w: string) => n + ' ' + w + (n === 1 ? '' : 's') + ' ago';
  if (m < 1) return 'just now';
  if (m < 60) return unit(Math.floor(m), 'minute');
  if (m < 48 * 60) return unit(Math.floor(m / 60), 'hour');
  if (m < 14 * 1440) return unit(Math.floor(m / 1440), 'day');
  if (m < 60 * 1440) return unit(Math.floor(m / 10080), 'week');
  return unit(Math.floor(m / 43200), 'month');
}
/** 919876543210 → "+91 98765 43210". */
function fmtPhone(p: string): string {
  const d = (p || '').replace(/\D/g, '');
  if (d.length === 12 && d.startsWith('91')) return '+91 ' + d.slice(2, 7) + ' ' + d.slice(7);
  return d ? '+' + d : '';
}
const oneLine = (s: string | null | undefined) => (s || '').replace(/\s+/g, ' ').trim();

// Links become anchors only after the text is escaped.
function linkify(escaped: string): string {
  return escaped.replace(/\bhttps?:\/\/[^\s<]+/g, (raw) => {
    let url = raw, tail = '';
    for (;;) {
      const m = url.match(/(&quot;|&#39;|[.,;:!?)\]])$/);
      if (!m) break;
      tail = m[1] + tail; url = url.slice(0, -m[1].length);
    }
    return '<a href="' + url + '" target="_blank" rel="noopener noreferrer">' + url + '</a>' + tail;
  });
}

// Initials avatar in a few calm, warm tones (white text >= 4.5:1 on each).
const TONES = ['#6b4a2f', '#7a4f3a', '#5c4a3d', '#4f5d52', '#5d5470', '#7a5a2e'];
function avatar(name: string | null, phone: string, big = false): string {
  const words = oneLine(name).split(' ').filter((w) => /\p{L}/u.test(w));
  const ini = words.length ? (words[0][0] + (words.length > 1 ? words[words.length - 1][0] : '')).toUpperCase() : '';
  let h = 0;
  for (const c of phone) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return '<span class="wa-av' + (big ? ' wa-av--big' : '') + '" style="background:' + TONES[h % TONES.length] + '" aria-hidden="true">' +
    (ini ? esc(ini) : '<svg viewBox="0 0 24 24" width="22" height="22"><circle cx="12" cy="9" r="4" fill="currentColor"/><path d="M4 20c1.5-4 4.5-6 8-6s6.5 2 8 6" fill="currentColor"/></svg>') + '</span>';
}

const TICK1 = '<svg viewBox="0 0 16 11" width="16" height="11" aria-hidden="true"><path d="M1.5 6l3.5 3.5L14.5 1.5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const TICK2 = '<svg viewBox="0 0 21 11" width="19" height="11" aria-hidden="true"><path d="M1.5 6l3.5 3.5L13 1.5M9 8.5l1 1L19.5 1.5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>';

// ── State ────────────────────────────────────────────────────────────────────
interface Pending { id: string; phone: string; text: string; at: string; busy: boolean; error: string | null; }
const S = {
  configured: true,
  filter: 'all' as WaFilter,
  q: '',
  threads: [] as WaThread[],
  next: null as string | null,
  listSeq: 0,
  listBusy: false,
  moreBusy: false,
  moreError: '',
  phone: null as string | null,        // the open conversation
  conv: null as WaThreadResponse | null,
  convSeq: 0,
  olderBusy: false,
  olderError: '',
  pushed: false,                       // we pushed a history entry for the open chat (phone layout)
};
const pend: Pending[] = [];
const drafts = new Map<string, string>();
let localSeq = 0;

// ── Conversation list ────────────────────────────────────────────────────────
function rowHtml(t: WaThread): string {
  const on = t.phone === S.phone;
  return '<button type="button" class="wa-row' + (on ? ' on' : '') + (t.unread ? ' is-unread' : '') + '" data-phone="' + esc(t.phone) + '"' + (on ? ' aria-current="true"' : '') + '>' +
    avatar(t.name, t.phone) +
    '<span class="wa-row__main">' +
      '<span class="wa-row__top"><span class="wa-row__name">' + esc(t.name || fmtPhone(t.phone)) + '</span>' +
      '<span class="wa-row__time">' + esc(listTime(t.last_at)) + '</span></span>' +
      '<span class="wa-row__bot"><span class="wa-row__pre">' + (t.last_direction === 'out' ? '<span class="wa-you">You: </span>' : '') + esc(oneLine(t.last_preview)) + '</span>' +
      (t.window_open ? '<span class="wa-dot" title="Can reply"><span class="ad-sr">Can reply</span></span>' : '') +
      (t.unread ? '<span class="wa-badge"><span class="ad-sr">Unread: </span>' + t.unread + '</span>' : '') +
      '</span>' +
    '</span></button>';
}

function skeleton(n: number): string {
  let s = '';
  for (let i = 0; i < n; i++) s += '<div class="wa-sk"><span class="wa-sk__av"></span><span class="wa-sk__lines"><i style="width:' + (40 + ((i * 17) % 35)) + '%"></i><i style="width:' + (60 + ((i * 23) % 30)) + '%"></i></span></div>';
  return '<div role="status" aria-label="Loading conversations">' + s + '</div>';
}

function stateHtml(title: string, body: string, retry?: string): string {
  return '<div class="wa-state' + (retry ? ' wa-state--err' : '') + '"' + (retry ? ' role="alert"' : '') + '><strong>' + esc(title) + '</strong><span>' + esc(body) + '</span>' +
    (retry ? '<button type="button" class="ad-btn ad-btn--ghost" ' + retry + '>Retry</button>' : '') + '</div>';
}

function footHtml(): string {
  if (S.moreBusy) return '<div class="wa-more" role="status"><span class="ad-spin" aria-hidden="true"></span> Loading more…</div>';
  if (S.moreError) return '<div class="wa-more wa-more--err" role="alert">' + esc(S.moreError) + ' <button type="button" class="ad-linkbtn" data-more>Retry</button></div>';
  return '';
}

function renderList() {
  const box = $('waRows');
  box.setAttribute('aria-busy', 'false');
  if (!S.configured) {
    box.innerHTML = '<div class="wa-setup"><p class="ad-display wa-setup__h">Not connected yet</p><p>WhatsApp inbox isn’t connected yet. Add WA_SUPABASE_URL and WA_SUPABASE_SERVICE_KEY in Vercel, then run whatsapp/supabase/migrations/0003_inbox.sql. Messages will appear here after that.</p></div>';
    return;
  }
  if (!S.threads.length) {
    const why = S.q ? 'Nothing matches “' + S.q + '”.' : S.filter === 'unread' ? 'Nothing unread. You’re up to date.' : S.filter === 'replied' ? 'No customer has replied yet.' : 'Messages sent to customers will show here.';
    box.innerHTML = stateHtml('No conversations', why);
    return;
  }
  box.innerHTML = S.threads.map(rowHtml).join('') + '<div id="waFoot">' + footHtml() + '</div>';
  fillScreen();
}

function paintFoot() { const f = document.getElementById('waFoot'); if (f) f.innerHTML = footHtml(); }

function paintRow(phone: string) {
  const t = S.threads.find((x) => x.phone === phone);
  const el = $('waRows').querySelector<HTMLElement>('.wa-row[data-phone="' + CSS.escape(phone) + '"]');
  if (t && el) el.outerHTML = rowHtml(t);
}

function markSelected() {
  $('waRows').querySelectorAll<HTMLElement>('.wa-row').forEach((el) => {
    const on = el.getAttribute('data-phone') === S.phone;
    el.classList.toggle('on', on);
    if (on) el.setAttribute('aria-current', 'true'); else el.removeAttribute('aria-current');
  });
}

function setConfigured(c: boolean) {
  S.configured = c;
  $('waApp').classList.toggle('is-off', !c);
  $('waTools').hidden = !c;
}

async function loadList(first?: Res<WaThreadsResponse>) {
  const seq = ++S.listSeq;
  S.listBusy = true; S.next = null; S.moreBusy = false; S.moreError = '';
  const box = $('waRows');
  if (!first) { box.innerHTML = skeleton(8); box.setAttribute('aria-busy', 'true'); }
  const r = first || (await getThreads(S.q, S.filter, null));
  if (seq !== S.listSeq) return;
  S.listBusy = false;
  if (!r.ok) { box.setAttribute('aria-busy', 'false'); box.innerHTML = stateHtml('Couldn’t load conversations', r.error, 'data-list'); return; }
  setConfigured(r.data.configured !== false);
  S.threads = r.data.threads || [];
  S.next = r.data.next_before || null;
  renderList();
}

async function loadMore() {
  if (!S.next || S.moreBusy || S.listBusy || !S.configured) return;
  const seq = S.listSeq;
  S.moreBusy = true; S.moreError = ''; paintFoot();
  const r = await getThreads(S.q, S.filter, S.next);
  if (seq !== S.listSeq) return;
  S.moreBusy = false;
  if (!r.ok) { S.moreError = r.error; paintFoot(); return; }
  const have = new Set(S.threads.map((t) => t.phone));
  const add = (r.data.threads || []).filter((t) => !have.has(t.phone));
  S.threads.push(...add);
  S.next = r.data.next_before || null;
  const foot = document.getElementById('waFoot');
  if (foot) { foot.insertAdjacentHTML('beforebegin', add.map(rowHtml).join('')); paintFoot(); }
  fillScreen();
}

// When the first page doesn't fill the pane there's no scroll to trigger "load more".
function fillScreen() {
  const box = $('waRows');
  if (S.next && box.offsetParent && box.scrollHeight <= box.clientHeight + 40) void loadMore();
}

// ── Conversation ─────────────────────────────────────────────────────────────
function threadInfo(phone: string) { return S.threads.find((t) => t.phone === phone) || null; }

function paintHeader() {
  const phone = S.phone!;
  const t = threadInfo(phone);
  const name = (S.conv && S.conv.name) || (t && t.name) || null;
  const pid = (S.conv && S.conv.person_id) || (t && t.person_id) || null;
  $('waAvatar').innerHTML = avatar(name, phone, true);
  $('waName').textContent = name || fmtPhone(phone);
  $('waPhone').textContent = name ? fmtPhone(phone) : '';
  const a = $('waPeople') as HTMLAnchorElement;
  a.hidden = !pid;
  if (pid) a.href = '/admin#people?id=' + encodeURIComponent(pid);
}

function closedNote(lastIn: string | null): string {
  return (lastIn ? 'They last wrote ' + ago(lastIn) + '.' : 'They haven’t written to you yet.') +
    ' WhatsApp only allows approved templates after 24 hours.';
}

function paintComposer() {
  const c = S.conv;
  const open = !!c && c.window_open && S.configured;
  const ta = $('waText') as HTMLTextAreaElement;
  ta.disabled = !open;
  ta.placeholder = open ? 'Type a message' : c ? 'Replies are closed' : 'Type a message';
  const note = $('waClosed');
  note.hidden = !c || open;
  if (c && !open) note.textContent = S.configured ? closedNote(c.last_inbound_at) : 'The inbox isn’t connected yet.';
  ($('waSend') as HTMLButtonElement).disabled = !open || !ta.value.trim();
}

function msgBody(m: WaMessage): string {
  const text = m.text ? '<span class="wa-t">' + linkify(esc(m.text)) + '</span>' : '';
  if ((m.kind === 'image' || m.kind === 'sticker' || m.kind === 'audio') && m.media_id) {
    const label = m.kind === 'audio' ? '🎤 Voice message' : m.kind === 'sticker' ? 'Sticker' : '📷 Photo';
    return '<span class="wa-media wa-media--' + m.kind + '" data-media="' + esc(m.media_id) + '" data-kind="' + m.kind + '">' + label + '</span>' + text;
  }
  if (m.kind === 'location' && m.text && /^-?\d+(\.\d+)?,\s*-?\d+(\.\d+)?$/.test(m.text.trim())) {
    return '<span class="wa-t"><a href="https://maps.google.com/?q=' + encodeURIComponent(m.text.trim()) + '" target="_blank" rel="noopener noreferrer">📍 Location</a></span>';
  }
  if (m.kind === 'reaction') return '<span class="wa-t wa-t--quiet">Reacted ' + esc(m.text || '') + '</span>';
  if (text) return text;
  const LABEL: Record<string, string> = { image: '📷 Photo', sticker: 'Sticker', audio: '🎤 Voice message', video: '🎬 Video', document: '📄 Document', location: '📍 Location', unsupported: 'A message WhatsApp can’t show here' };
  return '<span class="wa-t wa-t--quiet">' + esc(LABEL[m.kind] || 'Message') + '</span>';
}

function tickHtml(m: WaMessage, p?: Pending): string {
  if (p) return p.busy ? '<span class="wa-tick wa-tick--wait" role="img" aria-label="Sending">🕓</span>' : '';
  if (m.direction !== 'out' || !m.tick || m.tick === 'failed') return '';
  const label = m.tick === 'sent' ? 'Sent' : m.tick === 'delivered' ? 'Delivered' : 'Read';
  return '<span class="wa-tick wa-tick--' + m.tick + '" role="img" aria-label="' + label + '" title="' + label + '">' + (m.tick === 'sent' ? TICK1 : TICK2) + '</span>';
}

function msgHtml(m: WaMessage, first: boolean, byId: Map<string, WaMessage>, p?: Pending): string {
  const out = m.direction === 'out';
  let inner = '';
  if (m.template) inner += '<span class="wa-tpl">Template · ' + esc(m.template) + '</span>';
  if (m.reply_to && byId.has(m.reply_to)) {
    const q = byId.get(m.reply_to)!;
    inner += '<span class="wa-quote">' + esc((oneLine(q.text) || (q.kind === 'image' ? 'Photo' : 'Message')).slice(0, 140)) + '</span>';
  }
  const by = out && m.source === 'inbox' && m.sent_by ? '<span class="wa-by">' + esc(m.sent_by.split('@')[0]) + '</span>' : '';
  const meta = '<span class="wa-meta">' + by + '<time datetime="' + esc(m.at) + '">' + esc(clock(m.at)) + '</time>' + tickHtml(m, p) + '</span>';
  inner += msgBody(m) + meta;
  let below = '';
  if (p && p.error) below = '<p class="wa-fail" role="alert">Not sent: ' + esc(p.error) + ' · <button type="button" class="wa-retry" data-resend="' + esc(p.id) + '">Retry</button></p>';
  else if (!p && out && m.tick === 'failed') below = '<p class="wa-fail">Not delivered' + (m.failed_reason ? ': ' + esc(m.failed_reason) : '') + '</p>';
  return '<div class="wa-m ' + (out ? 'wa-m--out' : 'wa-m--in') + (first ? ' wa-m--first' : '') + (m.kind === 'sticker' && m.media_id ? ' wa-m--sticker' : '') +
    '" data-id="' + esc(p ? p.id : m.id) + '" data-dir="' + m.direction + '"><div class="wa-b">' + inner + '</div>' + below + '</div>';
}

const pendMsg = (p: Pending): WaMessage => ({
  id: p.id, direction: 'out', kind: 'text', source: 'inbox', template: null, text: p.text, media_id: null, media_mime: null,
  reply_to: null, sent_by: null, at: p.at, tick: null, failed_reason: null,
});

function renderMessages() {
  const box = $('waMsgs');
  const c = S.conv!;
  const mine = pend.filter((p) => p.phone === c.phone);
  const list: Array<{ m: WaMessage; p?: Pending }> = c.messages.map((m) => ({ m })).concat(mine.map((p) => ({ m: pendMsg(p), p })));
  const byId = new Map(c.messages.map((m) => [m.id, m] as [string, WaMessage]));
  let html = '';
  if (c.next_before) {
    html += '<div class="wa-earlier">' + (S.olderError
      ? '<span class="wa-fail" role="alert">' + esc(S.olderError) + '</span> <button type="button" class="ad-btn ad-btn--ghost ad-btn--sm" data-older>Retry</button>'
      : '<button type="button" class="ad-btn ad-btn--ghost ad-btn--sm" data-older' + (S.olderBusy ? ' disabled' : '') + '>' + (S.olderBusy ? 'Loading…' : 'Load earlier') + '</button>') + '</div>';
  }
  if (!list.length) html += '<p class="wa-day"><span>No messages yet</span></p>';
  let lastDay = '', lastDir = '';
  for (const { m, p } of list) {
    const day = dayKey(new Date(m.at).getTime());
    if (day !== lastDay) { html += '<p class="wa-day"><span>' + esc(dayLabel(m.at)) + '</span></p>'; lastDay = day; lastDir = ''; }
    html += msgHtml(m, m.direction !== lastDir, byId, p);
    lastDir = m.direction;
  }
  box.innerHTML = html;
  observeMedia();
}

const nearBottom = () => { const b = $('waMsgs'); return b.scrollHeight - b.scrollTop - b.clientHeight < 120; };
const toBottom = () => { const b = $('waMsgs'); b.scrollTop = b.scrollHeight; };

async function openConv(phone: string, how: 'push' | 'replace') {
  if (S.phone && S.phone !== phone) drafts.set(S.phone, ($('waText') as HTMLTextAreaElement).value);
  S.phone = phone; S.conv = null; S.olderBusy = false; S.olderError = '';
  if (how === 'push' && !wide()) { history.pushState({ waChat: phone }, '', '#c=' + phone); S.pushed = true; }
  else history.replaceState(history.state, '', '#c=' + phone);
  $('waApp').classList.add('is-chat');
  $('waEmpty').hidden = true;
  $('waConv').hidden = false;
  markSelected();
  paintHeader();
  const ta = $('waText') as HTMLTextAreaElement;
  ta.value = drafts.get(phone) || '';
  grow();
  paintComposer();
  await loadConv();
}

// quiet = refresh the open chat in place (no spinner, keep the reading position, and keep
// what's already on screen if the fetch fails).
async function loadConv(quiet = false) {
  const phone = S.phone;
  if (!phone) return;
  const seq = ++S.convSeq;
  const box = $('waMsgs');
  const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 120;
  if (!quiet) box.innerHTML = '<div class="wa-loading" role="status"><span class="ad-spin" aria-hidden="true"></span> Loading messages…</div>';
  const r = await getThread(phone, null);
  if (seq !== S.convSeq || phone !== S.phone) return;
  if (!r.ok) {
    if (quiet) return;
    S.conv = null; paintComposer(); box.innerHTML = stateHtml('Couldn’t load this conversation', r.error, 'data-conv'); return;
  }
  if (r.data.configured === false) setConfigured(false);
  S.conv = r.data;
  S.olderError = '';
  // The API marks the conversation read when it's opened.
  const t = threadInfo(phone);
  if (t) { t.unread = 0; t.window_open = r.data.window_open; paintRow(phone); markSelected(); }
  paintHeader();
  if (quiet) {
    const fromBottom = box.scrollHeight - box.scrollTop;
    renderMessages();
    if (nearBottom) toBottom(); else box.scrollTop = box.scrollHeight - fromBottom;
    paintComposer();
    return;
  }
  renderMessages();
  paintComposer();
  toBottom();
  if (wide() && !touch()) ($('waText') as HTMLTextAreaElement).focus({ preventScroll: true });
}

// Refresh = the list AND the open chat, so a message that shows in the list is in the chat too.
async function refreshAll() {
  await Promise.all([loadList(), S.phone ? loadConv(true) : Promise.resolve()]);
}

async function loadOlder() {
  const c = S.conv;
  if (!c || !c.next_before || S.olderBusy) return;
  const phone = c.phone, seq = S.convSeq;
  S.olderBusy = true; S.olderError = '';
  renderKeepingPlace();
  const r = await getThread(phone, c.next_before);
  if (seq !== S.convSeq || S.conv !== c) return;
  S.olderBusy = false;
  if (!r.ok) { S.olderError = r.error; renderKeepingPlace(); return; }
  const have = new Set(c.messages.map((m) => m.id));
  c.messages = (r.data.messages || []).filter((m) => !have.has(m.id)).concat(c.messages);
  c.next_before = r.data.next_before;
  renderKeepingPlace();
}

// Re-render without the view jumping: keep the same distance from the bottom.
function renderKeepingPlace() {
  const b = $('waMsgs');
  const fromBottom = b.scrollHeight - b.scrollTop;
  renderMessages();
  b.scrollTop = b.scrollHeight - fromBottom;
}

function closeConvUi() {
  if (S.phone) drafts.set(S.phone, ($('waText') as HTMLTextAreaElement).value);
  S.phone = null; S.conv = null; S.convSeq++; S.pushed = false;
  $('waApp').classList.remove('is-chat');
  $('waConv').hidden = true;
  $('waEmpty').hidden = false;
  markSelected();   // the loaded list is reused; it refetches only on Refresh
}

// ── Media: fetched when it scrolls into view ─────────────────────────────────
let IO: IntersectionObserver | null = null;
function observeMedia() {
  const els = $('waMsgs').querySelectorAll<HTMLElement>('[data-media]:not([data-seen])');
  if (!els.length) return;
  if (!IO && 'IntersectionObserver' in window) {
    IO = new IntersectionObserver((entries) => {
      entries.forEach((e) => { if (e.isIntersecting) { IO!.unobserve(e.target); void showMedia(e.target as HTMLElement); } });
    }, { root: $('waMsgs'), rootMargin: '300px 0px' });
  }
  els.forEach((el) => { el.setAttribute('data-seen', ''); if (IO) IO.observe(el); else void showMedia(el); });
}

async function showMedia(el: HTMLElement) {
  const id = el.getAttribute('data-media') || '', kind = el.getAttribute('data-kind') || 'image';
  el.classList.add('is-loading');
  const url = await mediaUrl(id, kind);
  if (!el.isConnected) return;
  el.classList.remove('is-loading');
  if (!url) { el.classList.add('is-missing'); el.textContent = (kind === 'audio' ? 'Voice message' : 'Photo') + ' unavailable'; return; }
  const stick = nearBottom();
  if (kind === 'audio') {
    el.outerHTML = '<audio class="wa-audio" controls preload="metadata" src="' + esc(url) + '"></audio>';
    return;
  }
  const a = document.createElement('a');
  a.className = 'wa-img wa-img--' + kind;
  a.href = url; a.target = '_blank'; a.rel = 'noopener noreferrer';
  a.setAttribute('aria-label', kind === 'sticker' ? 'Sticker, open full size' : 'Photo, open full size');
  const img = document.createElement('img');
  img.alt = kind === 'sticker' ? 'Sticker' : 'Photo from the customer';
  img.src = url;
  img.addEventListener('load', () => { if (stick) toBottom(); }, { once: true });
  a.appendChild(img);
  el.replaceWith(a);
}

// ── Sending ──────────────────────────────────────────────────────────────────
function grow() {
  const ta = $('waText') as HTMLTextAreaElement;
  ta.style.height = 'auto';
  ta.style.height = Math.min(ta.scrollHeight, 160) + 'px';
}

function doSend() {
  const ta = $('waText') as HTMLTextAreaElement;
  const text = ta.value.trim();
  if (!text || !S.phone || !S.conv || !S.conv.window_open) return;
  ta.value = ''; grow();
  drafts.delete(S.phone);
  const p: Pending = { id: 'local:' + ++localSeq, phone: S.phone, text, at: new Date().toISOString(), busy: true, error: null };
  pend.push(p);
  renderMessages();
  toBottom();
  paintComposer();
  void deliver(p);
}

async function deliver(p: Pending) {
  p.busy = true; p.error = null;
  repaintPending(p);
  const r = await sendText(p.phone, p.text);
  p.busy = false;
  if (r.ok && r.message) {
    pend.splice(pend.indexOf(p), 1);
    // Swap in the stored message; the thread isn't re-fetched.
    if (S.conv && S.conv.phone === p.phone) S.conv.messages.push(r.message);
    const el = $('waMsgs').querySelector<HTMLElement>('[data-id="' + CSS.escape(p.id) + '"]');
    if (el && S.conv && S.conv.phone === p.phone) {
      const byId = new Map(S.conv.messages.map((m) => [m.id, m] as [string, WaMessage]));
      el.outerHTML = msgHtml(r.message, el.classList.contains('wa-m--first'), byId);
    }
    bumpThread(p.phone, r.message);
  } else {
    p.error = r.error || 'WhatsApp didn’t accept the message.';
    repaintPending(p);
  }
}

function repaintPending(p: Pending) {
  const el = $('waMsgs').querySelector<HTMLElement>('[data-id="' + CSS.escape(p.id) + '"]');
  if (!el) return;
  const stick = nearBottom();
  el.outerHTML = msgHtml(pendMsg(p), el.classList.contains('wa-m--first'), new Map(), p);
  if (stick) toBottom();
}

function bumpThread(phone: string, m: WaMessage) {
  const i = S.threads.findIndex((t) => t.phone === phone);
  if (i < 0) return;
  const t = S.threads[i];
  t.last_at = m.at; t.last_direction = 'out'; t.last_preview = m.text || t.last_preview;
  S.threads.splice(i, 1);
  S.threads.unshift(t);
  const box = $('waRows');
  const keep = box.scrollTop;
  renderList();
  box.scrollTop = keep;
}

// ── Pull down to refresh (phone) ─────────────────────────────────────────────
function bindPull() {
  const box = $('waRows'), ptr = $('waPtr');
  let y0 = -1, dy = 0;
  const reset = () => { ptr.style.height = '0px'; ptr.textContent = ''; ptr.classList.remove('is-ready'); };
  box.addEventListener('touchstart', (e) => {
    y0 = box.scrollTop <= 0 && !S.listBusy && e.touches.length === 1 ? e.touches[0].clientY : -1;
    dy = 0;
  }, { passive: true });
  box.addEventListener('touchmove', (e) => {
    if (y0 < 0) return;
    dy = e.touches[0].clientY - y0;
    if (dy <= 0 || box.scrollTop > 0) { reset(); return; }
    const ready = dy > 110;
    ptr.style.height = Math.min(dy * 0.45, 56) + 'px';
    ptr.textContent = ready ? 'Release to refresh' : 'Pull to refresh';
    ptr.classList.toggle('is-ready', ready);
  }, { passive: true });
  const end = () => {
    const go = y0 >= 0 && dy > 110;
    y0 = -1; dy = 0; reset();
    if (go) void refreshAll();
  };
  box.addEventListener('touchend', end);
  box.addEventListener('touchcancel', () => { y0 = -1; dy = 0; reset(); });
}

// ── Phone: keep the composer above the on-screen keyboard ────────────────────
// 100dvh doesn't shrink for the keyboard on iOS (and Chrome by default), so the app
// follows the visual viewport's height instead. Event-driven only.
function bindViewport() {
  const vv = window.visualViewport;
  if (!vv) return;
  const fit = () => {
    if (wide()) { document.documentElement.style.removeProperty('--wa-h'); return; }
    document.documentElement.style.setProperty('--wa-h', Math.round(vv.height) + 'px');
    if (vv.offsetTop > 0 || window.scrollY > 0) window.scrollTo(0, 0);
  };
  vv.addEventListener('resize', fit);
  fit();
}

// ── Wiring ───────────────────────────────────────────────────────────────────
const hashPhone = (): string | null => {
  const m = (location.hash || '').match(/^#c=(\d{6,20})$/);
  return m ? m[1] : null;
};

function bind() {
  $('waRows').addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const row = t.closest<HTMLElement>('.wa-row');
    if (row) { const p = row.getAttribute('data-phone')!; if (p !== S.phone || !wide()) void openConv(p, 'push'); return; }
    if (t.closest('[data-list]')) void loadList();
    if (t.closest('[data-more]')) { S.moreError = ''; void loadMore(); }
  });
  $('waRows').addEventListener('scroll', () => {
    const b = $('waRows');
    if (b.scrollHeight - b.scrollTop - b.clientHeight < 200) void loadMore();
  }, { passive: true });
  $('waListRefresh').addEventListener('click', () => { void refreshAll(); });
  $('waConvRefresh').addEventListener('click', () => { void refreshAll(); });

  document.querySelectorAll<HTMLElement>('[data-filter]').forEach((b) => b.addEventListener('click', () => {
    S.filter = b.getAttribute('data-filter') as WaFilter;
    document.querySelectorAll<HTMLElement>('[data-filter]').forEach((x) => {
      const on = x === b; x.classList.toggle('on', on); x.setAttribute('aria-pressed', String(on));
    });
    void loadList();
  }));

  let deb = 0;
  $('waSearch').addEventListener('input', () => {
    clearTimeout(deb);
    deb = window.setTimeout(() => {
      const q = ($('waSearch') as HTMLInputElement).value.trim();
      if (q === S.q) return;
      S.q = q; void loadList();
    }, 300);
  });

  $('waMsgs').addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    if (t.closest('[data-older]')) { S.olderError = ''; void loadOlder(); return; }
    if (t.closest('[data-conv]')) { void loadConv(); return; }
    const re = t.closest<HTMLElement>('[data-resend]');
    if (re) { const p = pend.find((x) => x.id === re.getAttribute('data-resend')); if (p && !p.busy) void deliver(p); }
  });

  const ta = $('waText') as HTMLTextAreaElement;
  ta.addEventListener('input', () => { grow(); paintComposer(); });
  ta.addEventListener('keydown', (e) => {
    // Desktop: Enter sends, Shift+Enter is a new line. Touch: Enter is always a new line.
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && !touch()) { e.preventDefault(); doSend(); }
  });
  $('waForm').addEventListener('submit', (e) => { e.preventDefault(); doSend(); ta.focus({ preventScroll: true }); });

  $('waBack').addEventListener('click', () => {
    if (S.pushed) history.back();
    else { history.replaceState(null, '', location.pathname + location.search); closeConvUi(); }
  });
  window.addEventListener('popstate', () => {
    const p = hashPhone();
    if (!p) { if (S.phone) closeConvUi(); }
    else if (p !== S.phone) { S.pushed = !wide(); void openConv(p, 'replace'); }
  });

  bindPull();
  bindViewport();
}

// ── Boot ─────────────────────────────────────────────────────────────────────
function showApp(first?: Res<WaThreadsResponse>) {
  $('waGate').hidden = true;
  $('waDenied').hidden = true;
  $('waApp').hidden = false;
  if (DEMO) { $('waSample').hidden = false; first = undefined; }
  void loadList(first);
  const p = hashPhone();
  if (p) {
    // A refresh with #c= reopens that chat. On a phone, put the list underneath it in
    // history so the back gesture still lands on the list.
    if (!wide()) {
      history.replaceState(null, '', location.pathname + location.search);
      history.pushState({ waChat: p }, '', '#c=' + p);
      S.pushed = true;
    }
    void openConv(p, 'replace');
  }
}

function showDenied(email: string | null) {
  $('waGate').hidden = true;
  $('waApp').hidden = true;
  $('waDenied').hidden = false;
  $('waDeniedWho').textContent = email ? 'You’re signed in as ' + email + '. Sign out and use a founder’s Google account.' : 'Sign out and use a founder’s Google account.';
}

const setStatus = (m: string) => { $('waSigninStatus').textContent = m || ''; };

// The first conversation-list call doubles as the access check: 401 = not an admin.
async function enter(email: string | null): Promise<boolean> {
  const r = await call<WaThreadsResponse>({ view: 'threads', filter: 'all' });
  if (!r.ok && r.status === 401) { showDenied(email); return true; }
  showApp(r);
  return true;
}

async function boot() {
  bind();
  if (DEMO_SKIPS_AUTH) { showApp(); return; }
  $('waGate').hidden = false;
  const btn = $('waGoogle') as HTMLButtonElement;
  btn.disabled = true;
  setStatus('Checking your session…');
  try {
    const user = await getSessionUser();
    if (user && (await enter(user.email))) { setStatus(''); return; }
  } catch { /* fall through to the gate */ }
  setStatus('');
  btn.disabled = false;
}

$('waGoogle').addEventListener('click', async () => {
  const btn = $('waGoogle') as HTMLButtonElement;
  btn.disabled = true;
  setStatus('Opening Google…');
  try {
    const user = await signInWithGoogle();
    if (!user) { setStatus('Google sign-in is unavailable — please try again.'); btn.disabled = false; return; }
    setStatus('Signing in…');
    await getIdToken(true);
    await enter(user.email);
    setStatus('');
    btn.disabled = false;
  } catch (err: any) {
    const code = (err && err.code) || '';
    if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') setStatus('Sign-in cancelled.');
    else if (code === 'auth/unauthorized-domain') setStatus('This domain isn’t authorised in Firebase yet.');
    else setStatus('Sign-in failed' + (code ? ' (' + code + ')' : '') + '.');
    btn.disabled = false;
  }
});

$('waSignOut').addEventListener('click', async () => {
  try { await signOut(); } catch { /* already out */ }
  $('waDenied').hidden = true;
  $('waGate').hidden = false;
  setStatus('');
  ($('waGoogle') as HTMLButtonElement).disabled = false;
});

boot();
