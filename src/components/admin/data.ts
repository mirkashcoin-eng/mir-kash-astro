// The ONLY module in the admin UI that talks to the network (besides Firebase sign-in).
// Views call the getX() functions below and get view-model types back.
//
// Rules:
//  - Nothing polls. A view's data is fetched when the user opens it, and again only when
//    they change the date range or a toggle (each combination is cached in memory).
//  - Once per dashboard open (after sign-in), POST /api/admin/refresh pulls new Shopify
//    orders/bookings and rebuilds the People copy. Today/Understand/People fetches wait
//    for it, but never for more than REFRESH_WAIT_MS, and a failure never blocks them.
//  - ?demo=1 serves clearly-labelled sample fixtures (fixtures.ts) instead of the API.
//  - Operations views keep using the existing /api/admin/data feed.
import { getIdToken } from '~/lib/firebaseClient';
import type {
  AcquisitionData, AudienceData, CheckoutData, InboxData, InboxKind, Metric, OverviewData, PeopleList,
  PeopleQuery, PersonDetail, ProductsData, RefreshState, Result, RetentionData, TrackingHealth,
} from './types';
import * as fx from './fixtures';
import { DEFAULT_OUTCOMES, mapInbox, mapPeopleList, mapPersonDetail } from './mapping';

// ── Demo flag ────────────────────────────────────────────────────────────────
// Sample data only ever renders when explicitly asked for. In a dev build it also
// skips the sign-in gate (so the shell can be reviewed); in production the gate is
// untouched and ?demo=1 merely swaps the numbers after a real sign-in.
// ?demo=live (dev builds only) skips the gate but calls the real endpoints, for
// exercising them against a test database through a local, auth-stubbed harness.
const params = typeof location !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams();
export const DEMO = params.get('demo') === '1';
const LIVE_PREVIEW = import.meta.env.DEV === true && params.get('demo') === 'live';
export const DEMO_SKIPS_AUTH = (DEMO || LIVE_PREVIEW) && import.meta.env.DEV === true;

export interface Query { from: string; to: string; compare: boolean; bots: boolean; test: boolean; }

// ── Auth + transport ─────────────────────────────────────────────────────────
export async function authHeaders(): Promise<Record<string, string> | null> {
  // Dev builds only: a placeholder token that only a local test harness (which stubs
  // Firebase verification) accepts. Real servers verify every token with Firebase.
  if (LIVE_PREVIEW) return { Authorization: 'Bearer dev-stub' };
  let t: string | null = null;
  try { t = await getIdToken(); } catch { /* signed out */ }
  return t ? { Authorization: 'Bearer ' + t } : null;
}

const SESSION_MSG = 'Your session has expired. Reload and sign in again.';
async function getJson<T>(url: string, headers: Record<string, string> | null): Promise<Result<T>> {
  try {
    const r = await fetch(url, { headers: headers || {} });
    if (!r.ok) {
      const body = await r.json().catch(() => null);
      const msg = r.status === 404 ? (body?.error === 'Not found' ? 'Not found.' : 'This view is not available yet.')
        : r.status === 401 || r.status === 403 ? SESSION_MSG
        : r.status === 503 ? 'The analytics database is unavailable right now. Try again in a minute.'
        : (body?.error ? String(body.error) : 'The server could not load this') + ' (HTTP ' + r.status + ').';
      return { ok: false, status: r.status, error: msg };
    }
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

// ── Refresh once per dashboard open ──────────────────────────────────────────
const REFRESH_WAIT_MS = 8000;
let REFRESH: Promise<RefreshState> | null = null;
let READY: Promise<void> = Promise.resolve();

/**
 * Start the once-per-open refresh. Safe to call more than once: only the first call
 * hits the server. `onState` hears 'running' at once, then 'done' or 'failed'.
 */
export function refreshOnce(onState: (s: RefreshState) => void): void {
  if (DEMO || REFRESH) return;
  onState({ status: 'running', asOf: null });
  REFRESH = (async (): Promise<RefreshState> => {
    try {
      const h = await authHeaders();
      const r = await fetch('/api/admin/refresh', { method: 'POST', headers: { ...(h || {}), 'Content-Type': 'application/json' }, body: '{}' });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j || j.ok === false) return { status: 'failed', asOf: j?.as_of ?? null };
      return { status: 'done', asOf: j.as_of ?? new Date().toISOString() };
    } catch {
      return { status: 'failed', asOf: null };
    }
  })();
  REFRESH.then((s) => { if (s.status === 'done') CACHE.clear(); onState(s); });
  // Sections wait for the refresh so they show today's orders, but never for long.
  READY = Promise.race([REFRESH.then(() => undefined), new Promise<void>((res) => setTimeout(res, REFRESH_WAIT_MS))]);
}

// ── In-memory cache ──────────────────────────────────────────────────────────
const CACHE = new Map<string, Promise<Result<any>>>();
function cached<T>(key: string, load: () => Promise<Result<T>>): Promise<Result<T>> {
  const hit = CACHE.get(key);
  if (hit) return hit;
  const p = READY.then(load).then((r) => { if (!r.ok) CACHE.delete(key); return r; });
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

// ── Section getters (metrics: still on fixtures until /api/admin/metrics lands) ──
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

// ── Action inbox: GET/POST /api/admin/inbox ──────────────────────────────────
// Not date-ranged: it is "what needs you now", so one fetch per page load.
let OUTCOMES: Partial<Record<InboxKind, string[]>> = {};
function remember(d: InboxData): InboxData {
  for (const g of d.groups) if (g.items[0]) OUTCOMES[g.key] = g.items[0].outcomes;
  return d;
}
/** Outcomes the API offered for this kind in the last inbox load (else its defaults). */
export const outcomesFor = (kind: InboxKind): string[] => OUTCOMES[kind] || DEFAULT_OUTCOMES[kind];

export function getInbox(): Promise<Result<InboxData>> {
  if (DEMO) return ok(remember(mapInbox(demoInboxRaw())));
  return cached<InboxData>('inbox', async () => {
    const r = await getJson<any>('/api/admin/inbox', await authHeaders());
    return r.ok ? { ok: true, data: remember(mapInbox(r.data)) } : r;
  });
}
let DEMO_INBOX: any = null;
function demoInboxRaw(): any { return (DEMO_INBOX = DEMO_INBOX || fx.demoInboxRaw()); }

/** Mark an inbox item (or a person, as kind 'hot_lead') handled. Returns an error message or null. */
export async function markDone(kind: InboxKind, ref: string, outcome: string, note?: string): Promise<string | null> {
  if (DEMO) {
    if (DEMO_INBOX) DEMO_INBOX.items = DEMO_INBOX.items.filter((i: any) => !(i.kind === kind && i.ref === ref));
    return null;
  }
  const h = await authHeaders();
  if (!h && !LIVE_PREVIEW) return SESSION_MSG;
  try {
    const r = await fetch('/api/admin/inbox', {
      method: 'POST',
      headers: { ...(h || {}), 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind, ref, outcome, ...(note ? { note } : {}) }),
    });
    const j = await r.json().catch(() => null);
    if (!r.ok || !j?.ok) return r.status === 401 ? SESSION_MSG : (j?.error ? String(j.error) : 'Could not save. Try again.');
    // What was handled changes the inbox and that person's detail; refetch those next time.
    for (const k of [...CACHE.keys()]) if (k === 'inbox' || k.startsWith('person|')) CACHE.delete(k);
    return null;
  } catch {
    return 'Could not reach the server. Try again.';
  }
}

// ── People: GET /api/admin/people ────────────────────────────────────────────
export const PAGE_SIZE = 50;
function peopleParams(q: Query, pq: PeopleQuery): URLSearchParams {
  const p = new URLSearchParams();
  if (pq.q) p.set('q', pq.q);
  if (pq.stage === 'returning') p.set('returning', '1');
  else if (pq.stage && pq.stage !== 'all') p.set('stage', pq.stage);
  if (pq.source) p.set('source', pq.source.toLowerCase());
  if (pq.device) p.set('device', pq.device.toLowerCase());
  if (pq.city) p.set('city', pq.city);
  if (pq.kind) p.set('kind', pq.kind);
  if (pq.minScore != null) p.set('min_score', String(pq.minScore));
  // The range filters on first seen (IST dates), like the API.
  p.set('from', q.from);
  p.set('to', q.to);
  if (q.bots) p.set('include_bots', '1');
  if (q.test) p.set('include_test', '1');
  p.set('sort', pq.sort || 'last_seen');
  p.set('page', String(pq.page || 1));
  p.set('size', String(PAGE_SIZE));
  for (const k of Object.keys(pq.extra || {})) p.set(k, pq.extra![k]);
  return p;
}

export function getPeople(q: Query, pq: PeopleQuery): Promise<Result<PeopleList>> {
  if (DEMO) return ok(mapPeopleList(fx.demoPeopleRaw(pq)));
  const p = peopleParams(q, pq);
  return cached<PeopleList>('people|' + p.toString(), async () => {
    const r = await getJson<any>('/api/admin/people?' + p.toString(), await authHeaders());
    return r.ok ? { ok: true, data: mapPeopleList(r.data) } : r;
  });
}

export function getPerson(id: string): Promise<Result<PersonDetail>> {
  if (DEMO) {
    const d = fx.demoPersonRaw(id);
    return ok(d ? mapPersonDetail(d) : (null as any)).then((r) => (d ? r : { ok: false, status: 404, error: 'Not found.' }));
  }
  return cached<PersonDetail>('person|' + id, async () => {
    const r = await getJson<any>('/api/admin/people?id=' + encodeURIComponent(id), await authHeaders());
    return r.ok ? { ok: true, data: mapPersonDetail(r.data) } : r;
  });
}

export function clearCache() { CACHE.clear(); }
