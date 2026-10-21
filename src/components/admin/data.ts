// The ONLY module in the admin UI that talks to the network (besides Firebase sign-in).
// Views call the getX() functions below and get view-model types back.
//
// Rules:
//  - Nothing polls. A view's data is fetched when the user opens it, and again only when
//    they change the date range or a toggle (each combination is cached in memory).
//  - ?demo=1 serves clearly-labelled sample fixtures (fixtures.ts) instead of the API.
//  - Operations views keep using the existing /api/admin/data feed.
import { getIdToken } from '~/lib/firebaseClient';
import type {
  AcquisitionData, AudienceData, CheckoutData, InboxData, Metric, OverviewData, PeopleList,
  PeopleQuery, PersonDetail, PersonRow, ProductsData, Result, RetentionData, Stage, TrackingHealth,
} from './types';
import * as fx from './fixtures';
import { esc, fmtDay, inr, when } from './format';

// ── Demo flag ────────────────────────────────────────────────────────────────
// Sample data only ever renders when explicitly asked for. In a dev build it also
// skips the sign-in gate (so the shell can be reviewed); in production the gate is
// untouched and ?demo=1 merely swaps the numbers after a real sign-in.
const params = typeof location !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams();
export const DEMO = params.get('demo') === '1';
export const DEMO_SKIPS_AUTH = DEMO && import.meta.env.DEV === true;

export interface Query { from: string; to: string; compare: boolean; bots: boolean; test: boolean; }

// ── Auth + transport ─────────────────────────────────────────────────────────
export async function authHeaders(): Promise<Record<string, string> | null> {
  let t: string | null = null;
  try { t = await getIdToken(); } catch { /* signed out */ }
  return t ? { Authorization: 'Bearer ' + t } : null;
}

/** Plain fetch for operations actions (confirm a booking, create an affiliate…). */
export function adminFetch(url: string, init?: RequestInit): Promise<Response> {
  return fetch(url, init);
}

async function getJson<T>(url: string, headers: Record<string, string> | null): Promise<Result<T>> {
  try {
    const r = await fetch(url, { headers: headers || {} });
    if (!r.ok) return { ok: false, status: r.status, error: r.status === 404 ? 'This view is not available yet.' : r.status === 401 || r.status === 403 ? 'Your session has expired. Reload and sign in again.' : 'The server could not load this (HTTP ' + r.status + ').' };
    const ct = r.headers.get('content-type') || '';
    if (ct.indexOf('json') < 0) return { ok: false, status: 404, error: 'This view is not available yet.' };
    return { ok: true, data: (await r.json()) as T };
  } catch {
    return { ok: false, status: 0, error: 'Could not reach the server. Check your connection and try again.' };
  }
}

// ── Legacy operations feed (/api/admin/data, /api/admin/affiliate) ───────────
export async function callData(headers: Record<string, string>): Promise<{ status: number; data: any }> {
  try {
    const r = await fetch('/api/admin/data', { headers });
    const j = await r.json().catch(() => null);
    return { status: r.status, data: r.ok ? j : null };
  } catch { return { status: 0, data: null }; }
}
export async function callAffiliates(headers: Record<string, string>): Promise<{ status: number; data: any }> {
  try {
    const r = await fetch('/api/admin/affiliate', { headers });
    const j = await r.json().catch(() => null);
    return { status: r.status, data: r.ok ? j : null };
  } catch { return { status: 0, data: null }; }
}
export const demoLegacy = fx.demoLegacy;

// The legacy payload, once loaded, also backs the People fallback and the Daily grid.
let LEGACY: any = null;
export const setLegacy = (d: any) => { LEGACY = d; };

// ── In-memory cache ──────────────────────────────────────────────────────────
const CACHE = new Map<string, Promise<Result<any>>>();
function cached<T>(key: string, load: () => Promise<Result<T>>): Promise<Result<T>> {
  const hit = CACHE.get(key);
  if (hit) return hit;
  const p = load().then((r) => { if (!r.ok) CACHE.delete(key); return r; });
  CACHE.set(key, p);
  return p;
}
const qs = (q: Query) =>
  'from=' + q.from + '&to=' + q.to + '&includeBots=' + (q.bots ? 1 : 0) + '&includeTest=' + (q.test ? 1 : 0);
const ok = <T>(data: T): Promise<Result<T>> => Promise.resolve({ ok: true, data });

// ── Metric normalisation (real mode) ─────────────────────────────────────────
// Server shape per metric: { value, num?, den?, prev, definition, smallSample }.
interface Spec { key: string; label: string; unit: Metric['unit']; drill?: PeopleQuery; lowerIsBetter?: boolean; note?: (raw: any) => string | undefined; }
function pick(raw: any, specs: Spec[], compare: boolean): Metric[] {
  const bag = (raw && (raw.metrics || raw)) || {};
  const out: Metric[] = [];
  for (const s of specs) {
    const m = bag[s.key];
    if (!m || typeof m !== 'object') continue;
    const den = m.den == null ? undefined : Number(m.den);
    out.push({
      key: s.key, label: s.label, unit: s.unit, drill: s.drill, lowerIsBetter: s.lowerIsBetter,
      value: m.value == null ? null : Number(m.value),
      num: m.num == null ? undefined : Number(m.num), den,
      prev: compare && m.prev != null ? Number(m.prev) : null,
      definition: String(m.definition || ''),
      smallSample: !!m.smallSample || (den != null && den < 30),
      note: s.note ? s.note(m) : undefined,
    });
  }
  return out;
}
const arr = <T>(v: any): T[] => (Array.isArray(v) ? v : []);

const OVERVIEW_SPECS: Spec[] = [
  { key: 'visitors', label: 'Visitors', unit: 'count', drill: { stage: 'all' } },
  { key: 'returning', label: 'Returning', unit: 'pct', drill: { stage: 'returning' } },
  { key: 'cartRate', label: 'Added to cart', unit: 'pct', drill: { stage: 'cart' } },
  { key: 'orders', label: 'Orders', unit: 'count', drill: { stage: 'ordered' } },
  { key: 'revenue', label: 'Revenue', unit: 'inr' },
  { key: 'medianOrder', label: 'Median order', unit: 'inr' },
];
const CHECKOUT_SPECS: Spec[] = [
  { key: 'checkoutStart', label: 'Reached checkout', unit: 'count' },
  { key: 'phoneRate', label: 'Gave phone', unit: 'pct', drill: { stage: 'phone' } },
  { key: 'paymentFail', label: 'Payment failures', unit: 'pct', lowerIsBetter: true, drill: { stage: 'payment' } },
  { key: 'checkoutConv', label: 'Checkout to order', unit: 'pct', drill: { stage: 'ordered' } },
];
const RETENTION_SPECS: Spec[] = [
  { key: 'repeatRate', label: 'Repeat buyers', unit: 'pct' },
  { key: 'daysToBuy', label: 'Median days to first order', unit: 'days', lowerIsBetter: true },
  { key: 'visitsToBuy', label: 'Median visits to first order', unit: 'count' },
];

// ── Section getters ──────────────────────────────────────────────────────────
function section<T>(name: string, q: Query, demo: () => T, adapt: (raw: any) => T): Promise<Result<T>> {
  if (DEMO) return ok(demo());
  return cached<T>(name + '|' + qs(q) + '|' + q.compare, async () => {
    const h = await authHeaders();
    const r = await getJson<any>('/api/admin/metrics/' + name + '?' + qs(q), h);
    return r.ok ? { ok: true, data: adapt(r.data) } : r;
  });
}

export const getOverview = (q: Query) => section<OverviewData>('overview', q, () => fx.demoOverview(q.from, q.to), (raw) => ({
  metrics: pick(raw, OVERVIEW_SPECS, q.compare),
  trend: arr(raw?.trend || raw?.series),
  funnel: raw?.funnel && raw.funnel.steps ? raw.funnel : { steps: arr(raw?.funnel) },
  channels: arr(raw?.channels),
}));
export const getAcquisition = (q: Query) => section<AcquisitionData>('acquisition', q, fx.demoAcquisition, (raw) => ({
  channels: arr(raw?.channels), campaigns: arr(raw?.campaigns), landingPages: arr(raw?.landingPages),
}));
export const getProducts = (q: Query) => section<ProductsData>('products', q, fx.demoProducts, (raw) => ({
  rows: arr(raw?.rows || raw?.products), soldOutDemand: arr(raw?.soldOutDemand), zeroResultSearches: arr(raw?.zeroResultSearches),
}));
export const getCheckout = (q: Query) => section<CheckoutData>('checkout', q, fx.demoCheckout, (raw) => ({
  metrics: pick(raw, CHECKOUT_SPECS, q.compare),
  funnel: raw?.funnel && raw.funnel.steps ? raw.funnel : { steps: arr(raw?.funnel) },
  failures: arr(raw?.failures), paymentMix: arr(raw?.paymentMix),
}));
export const getAudience = (q: Query) => section<AudienceData>('audience', q, fx.demoAudience, (raw) => raw as AudienceData);
export const getRetention = (q: Query) => section<RetentionData>('retention', q, fx.demoRetention, (raw) => ({
  metrics: pick(raw, RETENTION_SPECS, q.compare), cohorts: arr(raw?.cohorts),
}));

/** Tracking-health pill. Never throws; "unknown" when the endpoint isn't there. */
export async function getHealth(q: Query): Promise<TrackingHealth> {
  if (DEMO) return fx.demoHealth();
  const r = await cached<TrackingHealth>('health|' + q.to, async () => {
    const h = await authHeaders();
    const x = await getJson<any>('/api/admin/metrics/trackingHealth?' + qs(q), h);
    if (!x.ok) return x;
    const d = x.data || {};
    return { ok: true, data: { status: d.status || 'unknown', label: d.label || 'Tracking status unknown', checks: arr(d.checks) } };
  });
  return r.ok ? r.data : { status: 'unknown', label: 'Tracking status not available yet', checks: [] };
}

// ── Action inbox ─────────────────────────────────────────────────────────────
export function getInbox(): Promise<Result<InboxData>> {
  if (DEMO) return ok(demoInboxState());
  return cached<InboxData>('inbox', async () => {
    const h = await authHeaders();
    const r = await getJson<any>('/api/admin/inbox', h);
    if (!r.ok) return r;
    const groups = arr<any>(r.data?.groups);
    return { ok: true, data: { total: Number(r.data?.total ?? groups.reduce((s, g) => s + arr(g.items).length, 0)), groups } };
  });
}
let DEMO_INBOX: InboxData | null = null;
function demoInboxState(): InboxData { return (DEMO_INBOX = DEMO_INBOX || fx.demoInbox()); }

export async function markInboxDone(id: string, outcome?: string): Promise<boolean> {
  if (DEMO) return true;
  const h = await authHeaders();
  if (!h) return false;
  try {
    const r = await fetch('/api/admin/inbox', { method: 'POST', headers: { ...h, 'Content-Type': 'application/json' }, body: JSON.stringify({ id, outcome, done: true }) });
    if (r.ok) CACHE.delete('inbox');
    return r.ok;
  } catch { return false; }
}

// ── People ───────────────────────────────────────────────────────────────────
export async function getPeople(q: Query, pq: PeopleQuery): Promise<Result<PeopleList>> {
  if (DEMO) return ok(fx.demoPeople(pq));
  const key = ['people', qs(q), pq.q || '', pq.stage || '', pq.source || '', pq.device || '', pq.page || 1, JSON.stringify(pq.extra || {})].join('|');
  return cached<PeopleList>(key, async () => {
    const h = await authHeaders();
    const p = new URLSearchParams();
    if (pq.q) p.set('search', pq.q);
    if (pq.stage && pq.stage !== 'all') p.set('stage', pq.stage);
    if (pq.source) p.set('source', pq.source);
    if (pq.device) p.set('device', pq.device);
    p.set('page', String(pq.page || 1));
    for (const k of Object.keys(pq.extra || {})) p.set(k, pq.extra![k]);
    const r = await getJson<any>('/api/admin/people?' + qs(q) + '&' + p.toString(), h);
    if (r.ok) {
      const d = r.data || {};
      return { ok: true, data: { total: Number(d.total || 0), returning: Number(d.returning || 0), page: Number(d.page || 1), pageSize: Number(d.pageSize || 50), rows: arr<PersonRow>(d.rows || d.people) } };
    }
    // The new endpoint isn't deployed yet: fall back to the people list that
    // /api/admin/data already carries, so this view keeps working until it lands.
    if (r.status === 404 && LEGACY) return { ok: true, data: legacyPeople(q, pq) };
    return r;
  });
}

export async function getPerson(id: string, q: Query): Promise<Result<PersonDetail>> {
  if (DEMO) { const d = fx.demoPerson(id); return d ? { ok: true, data: d } : { ok: false, status: 404, error: 'Person not found.' }; }
  const h = await authHeaders();
  const legacy = id.indexOf('legacy:') === 0 ? LEGACY?.people?.find((p: any) => p.id === id.slice(7)) : null;
  if (legacy) return legacyPersonDetail(legacy, h);
  const r = await getJson<any>('/api/admin/people?id=' + encodeURIComponent(id) + '&includeTest=' + (q.test ? 1 : 0), h);
  if (!r.ok) return r;
  const d = r.data?.person || r.data;
  return { ok: true, data: { ...d, timeline: arr(d?.timeline), sections: arr(d?.sections) } };
}

// ── Legacy People adapter (Firestore list from /api/admin/data) ──────────────
const HIDDEN_TELS = ['7738784781', '8306883773'];
const tel10 = (x: unknown) => String(x == null ? '' : x).replace(/[^0-9]/g, '').slice(-10);
function legacyStage(p: any): Stage {
  if (p.stage === 'ordered') return 'ordered';
  if (p.stage === 'payment') return 'payment';
  if (p.stage === 'address') return 'address';
  if (p.stage === 'phone') return 'phone';
  if (p.stage === 'cart') return 'cart';
  return p.viewed && p.viewed.length ? 'viewed' : 'visited';
}
function legacyRow(p: any): PersonRow {
  const tel = tel10(p.phone);
  return {
    id: 'legacy:' + p.id,
    name: p.name || (p.phone ? 'Visitor' : 'Visitor'),
    location: p.country || '',
    contact: p.phone ? '+91 ' + tel.slice(0, 2) + '•••• ' + tel.slice(-4) : p.email ? p.email : 'no contact yet',
    stage: legacyStage(p),
    visits: Number(p.visits || 1),
    returning: Number(p.visits || 1) > 1,
    source: p.sourceLabel || 'Direct',
    device: '—',
    timeOnSiteMin: null,
    cartValue: p.ordered ? Number(p.orderTotal || 0) || null : Number(p.cartValue || 0) || null,
    score: null,
    ordered: !!p.ordered,
    isTest: HIDDEN_TELS.indexOf(tel) > -1,
  };
}
function legacyPeople(q: Query, pq: PeopleQuery): PeopleList {
  const all: any[] = (LEGACY?.people || []).filter((p: any) => (q.bots || !p.bot) && (q.test || HIDDEN_TELS.indexOf(tel10(p.phone)) < 0));
  const inRange = (p: any) => {
    const t = new Date(p.lastSeen || p.firstSeen || 0).getTime();
    if (!t) return false;
    return t >= new Date(q.from + 'T00:00:00+05:30').getTime() && t <= new Date(q.to + 'T23:59:59.999+05:30').getTime();
  };
  let rows = all.filter(inRange);
  const returning = rows.filter((p) => Number(p.visits || 1) > 1).length;
  if (pq.stage === 'returning') rows = rows.filter((p) => Number(p.visits || 1) > 1);
  else if (pq.stage && pq.stage !== 'all') rows = rows.filter((p) => legacyStage(p) === pq.stage);
  if (pq.q) {
    const s = pq.q.toLowerCase();
    rows = rows.filter((p) => [p.name, p.phone, p.email, p.address, p.sourceLabel, (p.items || []).join(' '), (p.viewed || []).join(' ')].join(' ').toLowerCase().indexOf(s) > -1);
  }
  const pageSize = 50, page = pq.page || 1;
  return { total: rows.length, returning, page, pageSize, rows: rows.slice((page - 1) * pageSize, page * pageSize).map(legacyRow) };
}
async function legacyPersonDetail(p: any, h: Record<string, string> | null): Promise<Result<PersonDetail>> {
  const row = legacyRow(p);
  let steps: any[] = [];
  if (h) {
    const r = await getJson<any>('/api/admin/journey?id=' + encodeURIComponent(p.id), h);
    if (r.ok) steps = arr(r.data?.steps);
  }
  const LABEL: Record<string, string> = { first_seen: 'Visited the site', cart: 'Added to bag', phone: 'Entered phone', address: 'Entered address' };
  const facts: [string, string][] = [];
  if (p.landing) facts.push(['Landed on', p.landing]);
  if (p.viewed && p.viewed.length) facts.push(['Bags viewed', p.viewed.join(', ')]);
  if (p.pageViews) facts.push(['Pages viewed', String(p.pageViews)]);
  if (p.orderCount > 1) facts.push(['Orders', p.orderCount + ' · repeat buyer']);
  if (p.lifetimeValue) facts.push(['Lifetime value', inr(p.lifetimeValue, p.cartCurrency)]);
  const sections: PersonDetail['sections'] = [];
  if (facts.length) sections.push({ title: 'Behaviour', rows: facts });
  if (p.address) sections.push({ title: 'Delivery address', text: p.address });
  if (p.cart && p.cart.lines && p.cart.lines.length) {
    sections.push({
      title: 'Their bag',
      lines: p.cart.lines.map((l: any) => ({ title: l.title, sub: l.variant, qty: l.quantity + ' × ' + inr(l.price, p.cartCurrency), total: inr(l.price * l.quantity, p.cartCurrency) })),
    });
  }
  if (p.booking) {
    const b = p.booking;
    sections.push({ title: b.flow === 'private_viewing' ? 'Private Viewing' : 'Try at Home', rows: [['Status', b.booked ? 'Booked' : 'Started, not booked'], ...(b.date ? [['Day', b.date] as [string, string]] : []), ...(b.slot ? [['Time', b.slot] as [string, string]] : [])] });
  }
  return {
    ok: true,
    data: {
      row, phone: p.phone || undefined, email: p.email || undefined,
      summary: [p.cartValue ? inr(p.cartValue, p.cartCurrency) + ' cart' : '', p.visits + (p.visits === 1 ? ' visit' : ' visits')].filter(Boolean).join(' · '),
      firstSeen: when(p.firstSeen), firstCame: p.sourceLabel || 'Direct', lastCame: p.sourceLabel || 'Direct',
      deviceLine: '—', timeOnSite: '—', sections,
      timeline: steps.map((s) => ({ at: when(s.at, true), text: LABEL[s.type] || s.type, sub: s.detail || undefined })),
    },
  };
}

export function clearCache() { CACHE.clear(); }
export const _unused = { esc, fmtDay };
