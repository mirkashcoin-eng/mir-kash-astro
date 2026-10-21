// Renderers for the "Today" and "Understand" sections. Each takes a mount element and the
// current query, asks data.ts for its view-model, and paints loading / error / empty /
// content states. No fetching happens here.
import type { ChannelRow, Metric, OverviewData, Result, Series } from './types';
import * as data from './data';
import type { Query } from './data';
import { empty, funnelBars, heatmap, hbars, info, kpiRow, lineChart, notEnough, panel, peopleHref, stacked } from './charts';
import type { BarRow } from './charts';
import { esc, fmtValue, inrShort, num, pct1, SMALL_SAMPLE } from './format';

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

const hasAny = (ms: Metric[]) => ms.some((m) => m.value != null && (m.den == null || m.den > 0 || (m.value || 0) > 0));

function channelsTable(rows: ChannelRow[], sub = ''): string {
  if (!rows.length) return notEnough('No orders or visits by channel in this range.');
  const top = Math.max(...rows.map((r) => r.revenue), 1);
  const small = (r: ChannelRow) => r.visitors < SMALL_SAMPLE;
  return '<div class="ad-scroll"><table class="ad-table"><thead><tr><th scope="col">Source</th><th scope="col" class="r">Visitors</th><th scope="col" class="r">Orders</th><th scope="col" class="r">Revenue</th><th scope="col" class="r">Cost per sale</th><th scope="col" class="ad-w160">Share of revenue</th></tr></thead><tbody>' +
    rows.map((r) => {
      const cps = r.costPerSale != null ? '₹' + num(r.costPerSale) : r.costNote ? esc(r.costNote) : '<span class="ad-mut" title="No spend recorded for this source">n/a</span>';
      return '<tr><td class="nm">' + (r.drill ? '<a href="' + esc(peopleHref(r.drill)) + '">' + esc(r.source) + '</a>' : esc(r.source)) + (small(r) ? '<div class="sub">too few to judge</div>' : '') + '</td><td class="r">' + num(r.visitors) + '</td><td class="r">' + num(r.orders) + '</td><td class="r">' + esc(inrShort(r.revenue)) + '</td><td class="r">' + cps + '</td><td><div class="ad-bar" role="img" aria-label="' + esc(Math.round((r.revenue / top) * 100) + '% of the top channel') + '"><i style="width:' + Math.max(1, Math.round((r.revenue / top) * 100)) + '%"></i></div></td></tr>';
    }).join('') + '</tbody></table></div>' + sub;
}

// ── Trend panel with series switch ───────────────────────────────────────────
function trendPanel(series: Series[], compare: boolean, uid: string): string {
  if (!series.length) return panel('Trend', '', notEnough());
  const tabs = series.length > 1
    ? '<div class="ad-seg" role="group" aria-label="Chart metric">' + series.map((s, i) => '<button type="button" class="ad-seg__b' + (i === 0 ? ' on' : '') + '" data-series="' + i + '" aria-pressed="' + (i === 0) + '">' + esc(s.label) + '</button>').join('') + '</div>' : '';
  return '<section class="ad-panel ad-trend" id="' + uid + '" data-compare="' + (compare ? 1 : 0) + '"><div class="ad-panel__h"><h3 class="ad-panel__t"><span data-trend-title>' + esc(series[0].label) + ' by day</span></h3>' + tabs +
    (compare ? '<span class="ad-chart-sub">Dotted line: previous period</span>' : '') + '</div><div class="ad-panel__body" data-trend-chart>' + lineChart(series[0], compare, series[0].label) + '</div></section>';
}
function wireTrend(el: HTMLElement, uid: string, series: Series[], compare: boolean) {
  const root = el.querySelector('#' + uid); if (!root) return;
  root.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('[data-series]') as HTMLElement | null; if (!b) return;
    const i = Number(b.getAttribute('data-series'));
    root.querySelectorAll('[data-series]').forEach((x) => { const on = x === b; x.classList.toggle('on', on); x.setAttribute('aria-pressed', String(on)); });
    (root.querySelector('[data-trend-chart]') as HTMLElement).innerHTML = lineChart(series[i], compare, series[i].label);
    (root.querySelector('[data-trend-title]') as HTMLElement).textContent = series[i].label + ' by day';
  });
}

function overviewBody(d: OverviewData, q: Query, uid: string, opts: { all: boolean }): string {
  const ms = opts.all ? d.metrics : d.metrics.filter((m) => m.key !== 'medianOrder');
  const kpis = hasAny(ms) ? kpiRow(ms) : notEnough('No visits recorded in this range yet.');
  return kpis +
    '<div class="ad-two">' + trendPanel(d.trend, q.compare, uid) +
    panel('Where people drop off', '', funnelBars(d.funnel, 'Funnel from visit to order')) + '</div>' +
    panel('Which channels bring buyers', 'Last touch before the order', channelsTable(d.channels), { flush: true });
}

export function renderOverview(el: HTMLElement, q: Query, opts: { all: boolean }) {
  const uid = 'trend' + (opts.all ? 'O' : 'T');
  return mount(el, data.getOverview(q), (d) => overviewBody(d, q, uid, opts), (d) => wireTrend(el, uid, d.trend, q.compare));
}

// ── Today: inbox ─────────────────────────────────────────────────────────────
export function renderInbox(el: HTMLElement, onOpenPerson: (id: string) => void) {
  return mount(el, data.getInbox(), (d) => {
    if (!d.groups.length || !d.total) return panel('Nothing needs you right now', '', '<p class="ad-note">New hot leads, failed payments and bookings to confirm will show up here.</p>');
    return '<div class="ad-inbox">' + d.groups.map((g) => {
      const rows = g.items.length ? g.items.map((it) =>
        '<div class="ad-irow" data-item="' + esc(it.id) + '"><div class="ad-irow__main">' +
        (it.personId ? '<button type="button" class="ad-linkbtn" data-person="' + esc(it.personId) + '">' + esc(it.title) + '</button>' : '<strong>' + esc(it.title) + '</strong>') +
        '<div class="ad-mut ad-small">' + esc(it.detail) + '</div></div>' +
        (it.bar != null ? '<div class="ad-bar ad-w120" role="img" aria-label="' + esc('Demand strength ' + it.bar + ' out of 100') + '"><i style="width:' + it.bar + '%"></i></div>' : '') +
        (it.score != null ? '<span class="ad-chip">Score ' + it.score + '</span>' : '') +
        it.actions.map((a, i) => a.kind === 'done'
          ? '<button type="button" class="ad-btn ad-btn--ghost" data-done="' + esc(it.id) + '" data-outcome="' + esc(a.label) + '">' + esc(a.label) + '</button>'
          : '<a class="ad-btn' + (i > 0 ? ' ad-btn--ghost' : '') + '" href="' + esc(a.href || '#') + '"' + (a.href && a.href.indexOf('http') === 0 ? ' target="_blank" rel="noopener"' : '') + '>' + esc(a.label) + '</a>').join('') +
        (it.note ? '<span class="ad-mut ad-small ad-irow__note">' + esc(it.note) + '</span>' : '') + '</div>').join('')
        : '<p class="ad-note ad-pad">Nothing here.</p>';
      return '<section class="ad-panel ad-panel--flush"><div class="ad-panel__h"><h3 class="ad-panel__t">' + esc(g.title) + '</h3><span class="ad-chip">' + g.items.length + '</span></div>' + rows + '</section>';
    }).join('') + '</div>';
  }, () => {
    el.querySelectorAll('[data-person]').forEach((b) => b.addEventListener('click', () => onOpenPerson((b as HTMLElement).getAttribute('data-person')!)));
    el.querySelectorAll('[data-done]').forEach((b) => b.addEventListener('click', async () => {
      const btn = b as HTMLButtonElement; btn.disabled = true;
      const ok = await data.markInboxDone(btn.getAttribute('data-done')!, btn.getAttribute('data-outcome') || undefined);
      if (!ok) { btn.disabled = false; btn.textContent = 'Try again'; return; }
      const row = btn.closest('.ad-irow'); if (row) row.remove();
    }));
  });
}
export function inboxCount(el: HTMLElement): string {
  return String(el.querySelectorAll('.ad-irow').length);
}

// ── Acquisition ──────────────────────────────────────────────────────────────
export function renderAcquisition(el: HTMLElement, q: Query) {
  return mount(el, data.getAcquisition(q), (d) => {
    if (!d.channels.length && !d.campaigns.length) return notEnough('No traffic in this range yet.');
    const camp = d.campaigns.length
      ? '<div class="ad-scroll"><table class="ad-table"><thead><tr><th scope="col">Campaign</th><th scope="col">Source</th><th scope="col" class="r">Visitors</th><th scope="col" class="r">Carts</th><th scope="col" class="r">Orders</th><th scope="col" class="r">Revenue</th><th scope="col" class="r">Spend</th><th scope="col" class="r">Return on spend</th></tr></thead><tbody>' +
        d.campaigns.map((c) => '<tr><td class="nm">' + esc(c.campaign) + '</td><td>' + esc(c.source) + '</td><td class="r">' + num(c.visitors) + '</td><td class="r">' + num(c.carts) + '</td><td class="r">' + num(c.orders) + '</td><td class="r">' + esc(inrShort(c.revenue)) + '</td><td class="r">' + (c.spend != null ? esc(inrShort(c.spend)) : '<span class="ad-mut">n/a</span>') + '</td><td class="r">' + (c.roas != null && c.spend ? esc(fmtValue(c.roas, 'ratio')) : '<span class="ad-mut">n/a</span>') + '</td></tr>').join('') + '</tbody></table></div>'
      : notEnough('No campaign-tagged visits in this range.');
    const lp: BarRow[] = d.landingPages.map((l) => ({ label: l.page, right: num(l.visitors) + ' visitors · ' + num(l.orders) + ' orders (' + pct1(l.orders, l.visitors) + ')', value: l.visitors }));
    return panel('Channels', 'Ranked by revenue', channelsTable(d.channels), { flush: true }) +
      panel('Campaigns', 'Return on spend = revenue ÷ ad spend', camp, { flush: true }) +
      panel('Landing pages', 'Where visits start', hbars(lp, 'Visitors by landing page'));
  });
}

// ── Products ─────────────────────────────────────────────────────────────────
export function renderProducts(el: HTMLElement, q: Query) {
  return mount(el, data.getProducts(q), (d) => {
    if (!d.rows.length) return notEnough('No product views in this range yet.');
    const tbl = '<div class="ad-scroll"><table class="ad-table"><thead><tr><th scope="col">Bag</th><th scope="col" class="r">Views</th><th scope="col" class="r">Added to cart</th><th scope="col" class="r">Ordered</th><th scope="col" class="r">Views to order</th><th scope="col" class="r">Median look</th></tr></thead><tbody>' +
      d.rows.map((r) => '<tr><td class="nm">' + esc(r.title) + (r.soldOut ? ' <span class="ad-chip ad-chip--orange">Sold out</span>' : '') + '</td><td class="r">' + num(r.views) + '</td><td class="r">' + num(r.carts) + '<div class="sub">' + (r.viewers >= SMALL_SAMPLE ? pct1(r.carts, r.viewers) + ' of ' + num(r.viewers) : 'too few to judge') + '</div></td><td class="r">' + num(r.orders) + '</td><td class="r">' + (r.viewers >= SMALL_SAMPLE ? pct1(r.orders, r.viewers) : '<span class="ad-mut">too few</span>') + '</td><td class="r">' + (r.medianViewSeconds != null ? esc(fmtValue(r.medianViewSeconds, 'seconds')) : '—') + '</td></tr>').join('') + '</tbody></table></div>';
    const sold = d.soldOutDemand.length
      ? hbars(d.soldOutDemand.map((s) => ({ label: s.title, right: num(s.views) + ' views · ' + num(s.longLooks) + ' looked longer than a minute', value: s.views })), 'Sold-out bags people still look at')
      : '<p class="ad-note">No sold-out bags are drawing views.</p>';
    const zero = d.zeroResultSearches.length
      ? hbars(d.zeroResultSearches.map((s) => ({ label: s.term, right: num(s.count) + ' searches', value: s.count })), 'Searches that found nothing')
      : '<p class="ad-note">No searches came back empty.</p>';
    return panel('Bags: views to orders', 'Views to order uses people who viewed the bag', tbl, { flush: true }) +
      '<div class="ad-two">' + panel('Wanted but sold out', '', sold) + panel('Searched for, not found', '', zero) + '</div>';
  });
}

// ── Checkout ─────────────────────────────────────────────────────────────────
export function renderCheckout(el: HTMLElement, q: Query) {
  return mount(el, data.getCheckout(q), (d) => {
    if (!hasAny(d.metrics) && !(d.funnel.steps && d.funnel.steps.length)) return notEnough('Nobody reached checkout in this range.');
    const fail = d.failures.length ? hbars(d.failures.map((f) => ({ label: f.reason, right: num(f.count), value: f.count })), 'Payment failures by reason') : '<p class="ad-note">No failed payments in this range.</p>';
    const mix = d.paymentMix.length ? hbars(d.paymentMix.map((f) => ({ label: f.label, right: num(f.count) + ' orders', value: f.count, blue: true })), 'Orders by payment method') : '<p class="ad-note">No orders yet.</p>';
    return kpiRow(d.metrics) + '<div class="ad-two">' + panel('Checkout steps', '', funnelBars(d.funnel, 'Checkout funnel')) + panel('Why payments fail', '', fail) + '</div>' + panel('How people pay', '', mix);
  });
}

// ── Audience ─────────────────────────────────────────────────────────────────
export function renderAudience(el: HTMLElement, q: Query) {
  return mount(el, data.getAudience(q), (d) => {
    const nr = d.newReturning;
    const rate = (o: number, v: number) => (v >= SMALL_SAMPLE ? pct1(o, v) : 'too few to judge');
    const nrNote = '<div class="ad-mut">New visitors convert at ' + rate(nr.new.orders, nr.new.visitors) + ', returning at ' + rate(nr.returning.orders, nr.returning.visitors) + '.</div><div class="ad-mut ad-small">' + num(nr.new.visitors) + ' new, ' + num(nr.returning.visitors) + ' returning. Orders: ' + num(nr.new.orders) + ' and ' + num(nr.returning.orders) + '.</div>';
    const dev = d.device;
    const devNote = '<div class="ad-mut">' + dev.map((x) => esc(x.label) + ' converts at ' + esc(rate(x.orders, x.visitors))).join(', ') + '.</div>';
    const ga = d.ga;
    const gaTag = '<span class="ad-chip">from Google Analytics</span>';
    const shares = (s: { label: string; share: number; hidden?: boolean }[]) => hbars(s.filter((x) => !x.hidden).map((x) => ({ label: x.label, right: x.share + '%', value: x.share, blue: true })), 'Share of visitors');
    const gaBlock = (title: string, body: string) =>
      '<section class="ad-panel"><div class="ad-panel__h"><h3 class="ad-panel__t">' + title + '</h3>' + gaTag + '</div><div class="ad-panel__body">' + (ga.available ? body : empty('Not enough data', ga.note || 'Google only shares this once Google Signals is on and a group is large enough.')) + '</div></section>';
    return '<div class="ad-two">' +
      panel('New vs returning', '', stacked([{ label: 'New', value: nr.new.visitors }, { label: 'Returning', value: nr.returning.visitors }], 'New versus returning visitors') + nrNote) +
      panel('Device', '', stacked(dev.map((x) => ({ label: x.label, value: x.visitors })), 'Visitors by device') + devNote) + '</div>' +
      '<div class="ad-two">' +
      gaBlock('Age', shares(ga.age) + '<p class="ad-note">Google only reports ages for people signed in to Google, so this is a sample, not everyone. Small groups are hidden.</p>') +
      gaBlock('Gender and interests', stacked(ga.gender.filter((g) => !g.hidden).map((g) => ({ label: g.label, value: g.share })), 'Gender') +
        '<h4 class="ad-h4">Interests</h4><div class="ad-chips">' + ga.interests.map((i) => '<span class="ad-chip">' + esc(i) + '</span>').join('') + '</div><p class="ad-note">Gender and interests need Google Signals to be on. Groups under about 50 people are hidden by Google.</p>') + '</div>' +
      '<div class="ad-two">' +
      panel('Top cities', '', hbars(d.cities.map((c) => ({ label: c.city, right: num(c.visitors) + ' visitors · ' + num(c.orders) + ' orders', value: c.visitors })), 'Visitors by city')) +
      '<section class="ad-panel"><div class="ad-panel__h"><h3 class="ad-panel__t">Likely gift orders</h3></div><div class="ad-panel__body">' +
      (d.gift.den != null && d.gift.den < SMALL_SAMPLE ? '<div class="ad-big">Too few to judge</div>' : '<div class="ad-big">' + esc(fmtValue(d.gift.value, 'pct')) + '</div>') +
      '<div class="ad-mut">' + (d.gift.num != null ? num(d.gift.num) + ' of ' + num(d.gift.den) + ' orders shipped to a different name or city than the buyer.' : '') + ' ' + info(d.gift.definition) + '</div>' +
      '<p class="ad-note">Worked out from the order. Customers are never asked.</p>' +
      '<h4 class="ad-h4">Browser and system</h4><div class="ad-mut">' + d.browsers.map((b) => esc(b.label) + ' ' + b.share + '%').join(' · ') + '</div></div></section></div>';
  });
}

// ── Retention ────────────────────────────────────────────────────────────────
export function renderRetention(el: HTMLElement, q: Query) {
  return mount(el, data.getRetention(q), (d) =>
    (d.metrics.length ? kpiRow(d.metrics) : '') + panel('Do people come back?', 'Share of each weekly cohort that returned, by weeks since first visit', heatmap(d.cohorts), { flush: true }));
}
