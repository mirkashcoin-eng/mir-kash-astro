// Renderers for the "Today" and "Understand" sections. Each takes a mount element and the
// current query, asks data.ts for the section's response (GET /api/admin/metrics/*, in
// the API's own shapes), and paints loading / error / empty / content states. Labels and
// hover definitions are the API's; nothing here fetches directly.
import type { AcquisitionBy, AcquisitionResponse, AttributionModel, Metric, OverviewResponse, Result, Series, Table } from './types';
import * as data from './data';
import type { Query } from './data';
import { apiTable, empty, funnelBars, heatmap, hbars, kpiCard, kpiRow, lineChart, notEnough, notes, panel, peopleHref, stacked } from './charts';
import type { BarRow } from './charts';
import { esc, fmtValue, num } from './format';
import type { PeopleQuery } from './types';

export const LOADING = '<div class="ad-state ad-state--load" role="status"><span class="ad-spin" aria-hidden="true"></span> Loading…</div>';

function errorBox(msg: string, retry = true): string {
  return '<div class="ad-state ad-state--err" role="alert"><strong>Couldn’t load this</strong><span>' + esc(msg) + '</span>' +
    (retry ? '<button type="button" class="ad-btn ad-btn--ghost" data-retry>Try again</button>' : '') + '</div>';
}

/** Paint loading, then the result. Stale responses (user changed range meanwhile) are dropped. */
const TOKENS = new WeakMap<HTMLElement, number>();
export async function mount<T>(el: HTMLElement, p: Promise<Result<T>>, paint: (d: T) => string, after?: (d: T) => void): Promise<void> {
  const t = (TOKENS.get(el) || 0) + 1;
  TOKENS.set(el, t);
  el.innerHTML = LOADING;
  el.setAttribute('aria-busy', 'true');
  const r = await p;
  if (TOKENS.get(el) !== t) return;
  el.removeAttribute('aria-busy');
  if (!r.ok) { el.innerHTML = errorBox(r.error); return; }
  el.innerHTML = paint(r.data);
  if (after) after(r.data);
}

// People-list filters behind the numbers that have one.
const DRILL: Record<string, PeopleQuery> = {
  visitors: { stage: 'all' }, returningVisitors: { stage: 'returning' }, orders: { stage: 'ordered' },
  viewedProduct: { stage: 'viewed' }, addedToCart: { stage: 'cart' }, startedCheckout: { stage: 'checkout' },
  startedPayment: { stage: 'payment' }, ordered: { stage: 'ordered' },
};
const card = (m: Metric | undefined, q: Query, note?: string) => (m ? kpiCard(m, { compare: q.compare, drill: DRILL[m.key], note }) : '');
const nothingYet = (ms: Metric[]) => ms.every((m) => m.value == null || m.value === 0);

// ── Trend panel with series switch ───────────────────────────────────────────
function seriesOf(d: OverviewResponse): Series[] {
  const pts = d.trend;
  return [
    { label: 'Revenue', unit: 'inr', points: pts.map((p) => ({ day: p.day, value: p.revenueInr, legacy: p.legacy, prev: p.prev?.revenueInr ?? null, prevDay: p.prev?.day })) },
    { label: 'Orders', unit: 'count', points: pts.map((p) => ({ day: p.day, value: p.orders, legacy: p.legacy, prev: p.prev?.orders ?? null, prevDay: p.prev?.day })) },
    { label: 'Visitors', unit: 'count', points: pts.map((p) => ({ day: p.day, value: p.visitors, legacy: p.legacy, prev: p.prev?.visitors ?? null, prevDay: p.prev?.day })) },
  ];
}
function trendPanel(series: Series[], uid: string, legacy: boolean): string {
  const tabs = '<div class="ad-seg" role="group" aria-label="Chart metric">' + series.map((s, i) => '<button type="button" class="ad-seg__b' + (i === 0 ? ' on' : '') + '" data-series="' + i + '" aria-pressed="' + (i === 0) + '">' + esc(s.label) + '</button>').join('') + '</div>';
  return '<section class="ad-panel ad-trend" id="' + uid + '"><div class="ad-panel__h"><h3 class="ad-panel__t"><span data-trend-title>' + esc(series[0].label) + ' by day</span></h3>' + tabs + '</div>' +
    '<div class="ad-panel__body"><div data-trend-chart>' + lineChart(series[0], series[0].label) + '</div>' +
    (legacy ? '<p class="ad-note">Shaded days come from the old counters, which didn’t count visitors.</p>' : '') + '</div></section>';
}
function wireTrend(el: HTMLElement, uid: string, series: Series[]) {
  const root = el.querySelector('#' + uid); if (!root) return;
  root.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('[data-series]') as HTMLElement | null; if (!b) return;
    const i = Number(b.getAttribute('data-series'));
    root.querySelectorAll('[data-series]').forEach((x) => { const on = x === b; x.classList.toggle('on', on); x.setAttribute('aria-pressed', String(on)); });
    (root.querySelector('[data-trend-chart]') as HTMLElement).innerHTML = lineChart(series[i], series[i].label);
    (root.querySelector('[data-trend-title]') as HTMLElement).textContent = series[i].label + ' by day';
  });
}

// ── Channels (acquisition by source, last visit) ─────────────────────────────
const sourceHref = (row: Table<any>['rows'][number]) => {
  const s = row.key?.source;
  return s && s !== '(unattributed)' && s !== '(direct)' ? peopleHref({ source: s }) : null;
};
function channelsPanel(a: AcquisitionResponse, q: Query, title = 'Which channels bring buyers'): string {
  return panel(title, 'Orders credited to the last visit before ordering', apiTable(a.table, {
    compare: q.compare, only: ['visitors', 'orders', 'revenue', 'conversionRate'], bar: 'revenue', href: sourceHref,
    firstHeader: 'Source', limit: 8, emptyText: 'No visits or orders by channel in this range.',
  }), { flush: true });
}

// ── Overview + Today ─────────────────────────────────────────────────────────
export function renderOverview(el: HTMLElement, q: Query, opts: { all: boolean }) {
  const uid = 'trend' + (opts.all ? 'O' : 'T');
  const both = Promise.all([data.getOverview(q), data.getAcquisition(q, { by: 'source', model: 'last' })]).then(([o, a]) =>
    (o.ok ? { ok: true as const, data: { o: o.data, a } } : o));
  return mount(el, both, ({ o, a }) => {
    const k = o.kpis;
    const median = k.medianOrderValue.value != null && !k.medianOrderValue.smallSample ? k.medianOrderValue.label + ': ' + fmtValue(k.medianOrderValue.value, 'inr') : undefined;
    const ms = opts.all
      ? [card(k.visitors, q), card(k.newVisitors, q), card(k.returningVisitors, q), card(k.sessions, q), card(k.engagedSessionRate, q),
         card(k.medianEngagedPerSession, q), card(k.orders, q), card(k.revenue, q), card(k.medianOrderValue, q), card(k.conversionRate, q)]
      : [card(k.visitors, q), card(k.returningVisitors, q), card(k.conversionRate, q), card(k.orders, q), card(k.revenue, q, median)];
    const kpis = nothingYet([k.visitors, k.orders]) ? notEnough('No visits or orders recorded in this range yet.') : kpiRow(ms);
    const ch = a.ok ? channelsPanel(a.data, q) : panel('Which channels bring buyers', '', '<p class="ad-note ad-pad">' + esc(a.error) + '</p>');
    return kpis +
      '<div class="ad-two">' + trendPanel(seriesOf(o), uid, o.trend.some((p) => p.legacy)) +
      panel('Where people drop off', 'Share of the step before', funnelBars(o.funnel, 'Funnel from visit to order', DRILL)) + '</div>' +
      ch + notes(o.notes);
  }, ({ o }) => wireTrend(el, uid, seriesOf(o)));
}

// ── Acquisition ──────────────────────────────────────────────────────────────
const acq: { by: AcquisitionBy; model: AttributionModel } = { by: 'source', model: 'last' };
const BY: [AcquisitionBy, string][] = [['source', 'Source'], ['source_medium', 'Source + medium'], ['campaign', 'Campaign'], ['content', 'Ad']];
const MODEL: [AttributionModel, string][] = [['last', 'Last visit'], ['first', 'First visit']];
function seg<T extends string>(name: string, label: string, opts: [T, string][], on: T): string {
  return '<div class="ad-seg" role="group" aria-label="' + esc(label) + '">' + opts.map(([v, l]) =>
    '<button type="button" class="ad-seg__b' + (v === on ? ' on' : '') + '" aria-pressed="' + (v === on) + '" data-' + name + '="' + v + '">' + esc(l) + '</button>').join('') + '</div>';
}
export function renderAcquisition(el: HTMLElement, q: Query) {
  el.innerHTML = '<div class="ad-toolbar"><span class="ad-mut ad-small">Group by</span>' + seg('by', 'Group by', BY, acq.by) +
    '<span class="ad-mut ad-small">Credit the order to</span>' + seg('model', 'Credit the order to', MODEL, acq.model) + '</div><div data-acq></div>';
  el.querySelectorAll<HTMLElement>('[data-by]').forEach((b) => b.addEventListener('click', () => { acq.by = b.getAttribute('data-by') as AcquisitionBy; renderAcquisition(el, q); }));
  el.querySelectorAll<HTMLElement>('[data-model]').forEach((b) => b.addEventListener('click', () => { acq.model = b.getAttribute('data-model') as AttributionModel; renderAcquisition(el, q); }));
  const body = el.querySelector('[data-acq]') as HTMLElement;
  return mount(body, data.getAcquisition(q, { ...acq }), (a) => {
    const spendCols = a.by === 'campaign' || a.by === 'content';
    const spendNote = spendCols && !a.spendAvailable ? '<p class="ad-note ad-pad">No ad spend is recorded for this range, so cost per sale and ROAS are empty.</p>' : '';
    const first = BY.find(([v]) => v === a.by)?.[1] || 'Source';
    return panel('Where buyers come from', a.model === 'first' ? 'Orders credited to the first visit ever' : 'Orders credited to the last visit before ordering',
      apiTable(a.table, { compare: q.compare, bar: 'revenue', firstHeader: first, href: a.by === 'source' ? sourceHref : undefined, emptyText: 'No visits in this range yet.' }) + spendNote, { flush: true }) +
      notes(a.notes);
  });
}

// ── Products ─────────────────────────────────────────────────────────────────
export function renderProducts(el: HTMLElement, q: Query) {
  return mount(el, data.getProducts(q), (p) => {
    if (!p.table.rows.length) return notEnough('No product views in this range yet.') + notes(p.notes);
    const sold: BarRow[] = p.table.rows
      .filter((r) => (r.cells.soldOutViews?.value ?? 0) > 0)
      .sort((a, b) => (b.cells.soldOutViews.value ?? 0) - (a.cells.soldOutViews.value ?? 0))
      .map((r) => ({ label: r.label, right: num(r.cells.soldOutViews.value) + ' sold-out views', value: r.cells.soldOutViews.value ?? 0 }));
    return panel('Bags: attention to orders', 'Sorted by views', apiTable(p.table, { compare: q.compare, firstHeader: 'Bag', bar: 'views' }), { flush: true }) +
      panel('Wanted but sold out', '', sold.length ? hbars(sold, 'Sold-out views by bag') : '<p class="ad-note">No views of sold-out colours in this range.</p>') +
      notes(p.notes);
  });
}

// ── Checkout ─────────────────────────────────────────────────────────────────
export function renderCheckout(el: HTMLElement, q: Query) {
  return mount(el, data.getCheckout(q), (c) => {
    if (!c.steps.length || !c.steps[0].value) return notEnough('Nobody added to cart in this range.') + notes(c.notes);
    const t = (title: string, tb: Table<any>, first: string, emptyText: string) => panel(title, '', apiTable(tb, { compare: q.compare, firstHeader: first, emptyText }), { flush: true });
    return kpiRow([card(c.kpis.paymentFailureRate, q), card(c.kpis.otpFailureRate, q)]) +
      panel('Checkout steps', 'People at each step · share of the step before', funnelBars(c.steps, 'Checkout funnel')) +
      '<div class="ad-two">' + t('Why payments fail', c.paymentFailures, 'Reason', 'No failed payments in this range.') +
      t('Why OTPs fail', c.otpFailures, 'Reason', 'No failed OTPs in this range.') + '</div>' +
      '<div class="ad-two">' + t('How people pay', c.paymentMethods, 'Method', 'No payment methods chosen in this range.') +
      t('Coupons tried', c.coupons, 'Code', 'No coupons tried in this range.') + '</div>' + notes(c.notes);
  });
}

// ── Audience ─────────────────────────────────────────────────────────────────
export function renderAudience(el: HTMLElement, q: Query) {
  const both = Promise.all([data.getAudience(q), data.getOverview(q)]).then(([a, o]) => (a.ok ? { ok: true as const, data: { a: a.data, o } } : a));
  return mount(el, both, ({ a, o }) => {
    const nr = o.ok ? o.data.kpis : null;
    const own = (dim: keyof typeof a.own, title: string, first: string, href?: (r: any) => string | null) =>
      panel(title, '', apiTable(a.own[dim], { compare: q.compare, only: ['visitors', 'share', 'buyers', 'conversionRate'], bar: 'visitors', firstHeader: first, limit: 10, href }), { flush: true });
    const deviceParts = a.own.device.rows.map((r) => ({ label: r.label, value: r.cells.visitors?.value ?? 0 }));
    const ga = (dim: keyof typeof a.ga, title: string, first: string) => {
      const g = a.ga[dim];
      return panel(title, '<span class="ad-chip">from Google Analytics</span>', g.available
        ? apiTable(g.table, { compare: q.compare, only: ['users', 'share'], bar: 'users', firstHeader: first })
        : '<div class="ad-panel__body">' + empty('Not enough data', g.note || 'Google Analytics has nothing for this yet.') + '</div>', { flush: true });
    };
    return '<div class="ad-two">' +
      panel('New vs returning', '', nr ? stacked([{ label: 'New', value: nr.newVisitors.value ?? 0 }, { label: 'Returning', value: nr.returningVisitors.value ?? 0 }], 'New versus returning visitors') +
        '<p class="ad-note">' + esc(num(nr.newVisitors.value) + ' new, ' + num(nr.returningVisitors.value) + ' returning.') + '</p>' : '<p class="ad-note">Not available right now.</p>') +
      panel('Device', '', stacked(deviceParts, 'Visitors by device')) + '</div>' +
      '<div class="ad-kpis">' + kpiCard(a.giftOrders, { compare: q.compare, note: 'Worked out from the order. Customers are never asked.' }) + '</div>' +
      '<div class="ad-two">' + own('device', 'Devices', 'Device', (r) => peopleHref({ device: r.key.value })) + own('city', 'Top cities', 'City', (r) => peopleHref({ city: r.key.value })) + '</div>' +
      '<div class="ad-two">' + own('browser', 'Browsers', 'Browser') + own('os', 'Systems', 'System') + '</div>' +
      own('country', 'Countries', 'Country') +
      '<div class="ad-two">' + ga('age', 'Age', 'Age') + ga('gender', 'Gender', 'Gender') + '</div>' +
      ga('interest', 'Interests', 'Interest') +
      '<p class="ad-note">Google only reports age, gender and interests for people signed in to Google with Signals on, and hides small groups — a sample, not everyone.</p>' +
      notes(a.notes);
  });
}

// ── Retention ────────────────────────────────────────────────────────────────
let COHORT_MODE: 'active' | 'buyers' = 'active';
export function renderRetention(el: HTMLElement, q: Query) {
  return mount(el, data.getRetention(q), (r) => {
    const k = r.kpis;
    const def = COHORT_MODE === 'active' ? 'Share of each weekly cohort with a visit, by weeks since first seen' : 'Share of each weekly cohort that ordered, by weeks since first seen';
    return kpiRow([card(k.returningVisitorShare, q), card(k.repeatPurchaseRate, q), card(k.medianDaysToFirstOrder, q), card(k.medianSessionsToFirstOrder, q)]) +
      panel('Do people come back?', def, heatmap(r.cohorts, COHORT_MODE, def), {
        flush: true,
        tools: '<div class="ad-seg" role="group" aria-label="Cohort measure"><button type="button" class="ad-seg__b' + (COHORT_MODE === 'active' ? ' on' : '') + '" data-cohort="active" aria-pressed="' + (COHORT_MODE === 'active') + '">Came back</button><button type="button" class="ad-seg__b' + (COHORT_MODE === 'buyers' ? ' on' : '') + '" data-cohort="buyers" aria-pressed="' + (COHORT_MODE === 'buyers') + '">Bought</button></div>',
      }) + notes(r.notes);
  }, () => {
    el.querySelectorAll<HTMLElement>('[data-cohort]').forEach((b) => b.addEventListener('click', () => {
      COHORT_MODE = b.getAttribute('data-cohort') as 'active' | 'buyers';
      renderRetention(el, q);   // cached: no refetch
    }));
  });
}
