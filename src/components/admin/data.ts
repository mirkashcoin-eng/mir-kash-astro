// The ONLY module in the admin UI that talks to the network (besides Firebase sign-in).
// Views call the getX() functions below and get view-model types back.
//
// Rules:
//  - Nothing polls. A view's data is fetched when the user opens it, and again only when
//    they change the date range or a toggle (each combination is cached in memory).
//  - Once per dashboard open (after sign-in), POST /api/admin/refresh pulls new Shopify
//    orders/bookings and rebuilds the People copy. Today/Understand/People fetches wait
//    for it, but never for more than REFRESH_WAIT_MS, and a failure never blocks them.
//  - ?demo=1 serves clearly-labelled sample fixtures (fixtures.ts) in the API's own shapes.
//  - Operations views keep using the existing /api/admin/data feed.
import { getIdToken } from '~/lib/firebaseClient';
import type {
  AcquisitionBy, AcquisitionResponse, AttributionModel, AudienceResponse, CheckoutResponse, FunnelDailyResponse,
  InboxData, InboxKind, OverviewResponse, PeopleList, PeopleQuery, PersonDetail, ProductsResponse, RefreshState,
  Result, RetentionResponse, TrackingHealth, TrackingHealthResponse,
} from './types';
import { fmtValue } from './format';
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
const ok = <T>(data: T): Promise<Result<T>> => Promise.resolve({ ok: true, data });

// ── Metrics: GET /api/admin/metrics/{section} ────────────────────────────────
// Responses are used as-is (src/lib/metrics/types.ts); the UI never relabels or
// redefines a number. Params: from/to (IST, inclusive), bots=1, test=1; acquisition
// also takes by + model.
export interface AcqOpts { by: AcquisitionBy; model: AttributionModel; }
function metricsUrl(name: string, from: string, to: string, q: Pick<Query, 'bots' | 'test'>, extra?: Record<string, string>): string {
  const p = new URLSearchParams({ from, to });
  if (q.bots) p.set('bots', '1');
  if (q.test) p.set('test', '1');
  for (const k of Object.keys(extra || {})) p.set(k, extra![k]);
  return '/api/admin/metrics/' + name + '?' + p.toString();
}
function section<T>(name: string, q: Query, demo: () => T, extra?: Record<string, string>, range?: { from: string; to: string }): Promise<Result<T>> {
  if (DEMO) return ok(demo());
  const url = metricsUrl(name, range?.from ?? q.from, range?.to ?? q.to, q, extra);
  return cached<T>(url, async () => getJson<T>(url, await authHeaders()));
}

export const getOverview = (q: Query) => section<OverviewResponse>('overview', q, () => fx.demoOverview(q.from, q.to));
export const getAcquisition = (q: Query, a: AcqOpts) =>
  section<AcquisitionResponse>('acquisition', q, () => fx.demoAcquisition(q.from, q.to, a), { by: a.by, model: a.model });
export const getProducts = (q: Query) => section<ProductsResponse>('products', q, () => fx.demoProducts(q.from, q.to));
export const getCheckout = (q: Query) => section<CheckoutResponse>('checkout', q, () => fx.demoCheckout(q.from, q.to));
export const getAudience = (q: Query) => section<AudienceResponse>('audience', q, () => fx.demoAudience(q.from, q.to));
export const getRetention = (q: Query) => section<RetentionResponse>('retention', q, () => fx.demoRetention(q.from, q.to));
/** Daily funnel for one month (IST days). The grid has its own crawler switch. */
export const getFunnelDaily = (q: Query, from: string, to: string, bots: boolean) =>
  section<FunnelDailyResponse>('funnelDaily', { ...q, bots }, () => fx.demoFunnelDaily(from, to), undefined, { from, to });

/** Tracking-health pill, derived from the trackingHealth section. Never throws. */
export async function getHealth(q: Query): Promise<TrackingHealth> {
  const r = await section<TrackingHealthResponse>('trackingHealth', q, () => fx.demoTrackingHealth(q.from, q.to));
  if (!r.ok) return { status: 'unknown', label: 'Tracking status unavailable', checks: [], notes: [r.error] };
  const k = r.data.kpis;
  const dead = k.daysWithoutPageViews.value ?? 0;
  const rejects = k.rejectRate.value ?? 0;
  const noEvents = (k.events.value ?? 0) === 0;
  const checks = [k.events, k.rejectRate, k.botShare, k.daysWithoutPageViews].map((m) => ({
    label: m.label,
    ok: m.key === 'daysWithoutPageViews' ? (m.value ?? 0) === 0 : m.key === 'rejectRate' ? (m.value ?? 0) < 0.02 : m.key === 'events' ? (m.value ?? 0) > 0 : true,
    detail: fmtValue(m.value, m.unit, false) + (m.num != null && m.den != null ? ' (' + m.num.toLocaleString('en-IN') + ' of ' + m.den.toLocaleString('en-IN') + ')' : ''),
    definition: m.definition,
  }));
  const par = r.data.shopifyParity;
  if (par) {
    checks.push({
      label: 'Orders match Shopify',
      ok: par.ok,
      detail: par.stores.map((s) => s.store + ': ' + (s.ours ?? '?') + ' of ' + (s.shopify ?? '?')).join(' · ') +
        (par.checkedAt ? ' · checked ' + new Date(par.checkedAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : ''),
      definition: 'Shopify\'s own order count compared with the orders this dashboard holds, per store, after the last sync.',
    });
  }
  const mismatch = par != null && !par.ok;
  const status = noEvents || dead > 0 || rejects >= 0.02 || mismatch ? 'degraded' : 'healthy';
  const label = noEvents ? 'No tracking events in this range'
    : dead > 0 ? 'Tracking gap: ' + dead + (dead === 1 ? ' day' : ' days') + ' with no page views'
    : rejects >= 0.02 ? 'Tracking: ' + fmtValue(rejects, 'rate') + ' of events refused'
    : mismatch ? 'Orders differ from Shopify'
    : par ? 'Tracking healthy · orders match Shopify'
    : 'Tracking healthy';
  return { status, label, checks, notes: r.data.notes };
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
  // The range means "had a visit in the range" — the same as every other section,
  // so a number's drill-down here shows the same people.
  p.set('from', q.from);
  p.set('to', q.to);
  p.set('range', 'active');
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
