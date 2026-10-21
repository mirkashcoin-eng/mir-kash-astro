// Self-check for the metrics layer: params, IST periods and the Metric builders
// (always), plus the SQL views and section queries against a real Postgres.
//
// Run: node src/lib/metrics/metrics.test.mjs
//      METRICS_TEST_DATABASE_URL=postgres://… node src/lib/metrics/metrics.test.mjs
//
// The SQL part needs a Neon TEST BRANCH with db/migrations applied — never point it at
// production. It only ever writes inside one transaction that is rolled back, and
// its fixture lives in March 2020, so it can't collide with real rows either way.
import assert from 'node:assert/strict';
import pg from 'pg';
import { addDays, bounds, isDay, parseParams, periods, rateCell, medianCell, table, column, istToday } from './core.ts';
import { SECTIONS } from './index.ts';

// ── Pure ─────────────────────────────────────────────────────────────────────

const q = (s) => new URLSearchParams(s);
const now = new Date('2026-10-21T20:00:00Z'); // 01:30 IST on the 22nd
assert.equal(istToday(now), '2026-10-22');    // IST, not UTC
assert.equal(istToday(new Date('2026-10-21T18:29:00Z')), '2026-10-21');

const def = parseParams(q(''), now);
assert.deepEqual([def.from, def.to, def.includeBots, def.includeTest, def.by, def.model],
  ['2026-09-25', '2026-10-22', false, false, 'source', 'last']); // 28 days, bots + test off
const p1 = parseParams(q('from=2026-10-01&to=2026-10-07&bots=1&test=true&by=campaign&model=first'), now);
assert.deepEqual([p1.includeBots, p1.includeTest, p1.by, p1.model], [true, true, 'campaign', 'first']);
for (const bad of ['from=2026-10-08&to=2026-10-07', 'from=2026-02-30&to=2026-03-01', 'from=x', 'to=2027-01-01',
  'from=2020-01-01&to=2026-10-01', 'by=ad', 'model=linear']) {
  assert.equal(typeof parseParams(q(bad), now), 'string', bad);
}
assert.ok(isDay('2024-02-29') && !isDay('2023-02-29') && !isDay('2024-2-1'));
assert.equal(addDays('2026-03-01', -1), '2026-02-28');

// Previous period = the same number of days right before.
assert.deepEqual(periods({ from: '2026-10-01', to: '2026-10-07' }).previous, { from: '2026-09-24', to: '2026-09-30', days: 7 });
assert.deepEqual(periods({ from: '2026-03-01', to: '2026-03-01' }).previous, { from: '2026-02-28', to: '2026-02-28', days: 1 });
// IST day boundaries as instants: 1 Oct IST starts 30 Sep 18:30 UTC.
const [a, b] = bounds({ from: '2026-10-01', to: '2026-10-01', days: 1 });
assert.equal(new Date(a).toISOString(), '2026-09-30T18:30:00.000Z');
assert.equal(new Date(b).toISOString(), '2026-10-01T18:30:00.000Z');

// Rates carry their parts; small bases are flagged; a zero base is null, not NaN.
assert.deepEqual(rateCell(42, 1350, 30, 1000), { value: 42 / 1350, num: 42, den: 1350, prev: 0.03, prevNum: 30, prevDen: 1000, smallSample: false });
assert.equal(rateCell(3, 29, null, null).smallSample, true);
assert.equal(rateCell(0, 0, 0, 0).value, null);
assert.equal(medianCell(1200, 0, null).value, null);
assert.equal(medianCell(1200, 12, 900).smallSample, true);

// A row that only existed last period is kept; rows sort by the first column.
const t = table([column('n', 'events')], [{ k: 'a', n: 1 }, { k: 'b', n: 5 }], [{ k: 'c', n: 9 }], (r) => r.k,
  (c, p, f) => ({ key: { value: f.k }, label: f.k, cells: { n: { value: c.n ?? 0, prev: p.n ?? null, smallSample: false } } }));
assert.deepEqual(t.rows.map((r) => [r.label, r.cells.n.value, r.cells.n.prev]), [['b', 5, null], ['a', 1, null], ['c', 0, 9]]);

console.log('metrics: pure checks passed');

// ── SQL ──────────────────────────────────────────────────────────────────────

const url = process.env.METRICS_TEST_DATABASE_URL;
if (!url) {
  console.log('metrics: SQL checks skipped (set METRICS_TEST_DATABASE_URL to a Neon test branch)');
  process.exit(0);
}

const ist = (s) => `${s.replace(' ', 'T')}:00+05:30`;
let seq = 0;
const uuid = (prefix = '0') => `${prefix.repeat(8)}-0000-4000-8000-${String(++seq).padStart(12, '0')}`;

// Fixture, March 2020. Range under test: 10–11 Mar (previous period: 8–9 Mar).
//   V1  new anonymous browser, mobile, 10 Mar: tote (engaged reported twice: 5 s then
//       12 s; gallery photos 0,1,1; added to cart) and clutch (3 s). Its page_view is
//       sent twice with the same event_id. Also one migrated event, which must not count.
//   P2  a person (phone 9876543210) first seen 1 Mar on V2 (google, tote), back on
//       10 Mar 23:30 IST (instagram, tote, sold-out colour) and 11 Mar 00:30 IST —
//       still 10 Mar in UTC — (direct, bag3, cart, checkout, phone, payment failed then
//       paid). Order O1 01:00 IST 11 Mar. Then a NEW device V3 on 11 Mar from the
//       newsletter (utm_campaign = Meta campaign id c123, clutch) and order O2 (USD).
//   VB  a crawler; PT a test person with an order; VL an imported (Firestore) browser;
//   V4  one visit on 9 Mar (previous period). Legacy counters for 5 Mar.
const visitors = [
  ['fx-v1', null, ist('2020-03-10 09:30'), false],
  ['fx-v2', '9876543210', ist('2020-03-01 10:00'), false],
  ['fx-v3', '9876543210', ist('2020-03-11 10:30'), false],
  ['fx-vb', null, ist('2020-03-10 12:00'), true],
  ['fx-vt', '7000000001', ist('2020-03-10 12:00'), false],
  ['fx-vl', null, ist('2020-03-10 08:00'), false],
  ['fx-v4', null, ist('2020-03-09 12:00'), false],
];
const sessions = [
  // id, visitor, start, source, medium, campaign, device
  ['fx-s1', 'fx-v1', ist('2020-03-10 09:30'), 'direct', 'none', null, 'mobile'],
  ['fx-s2a', 'fx-v2', ist('2020-03-01 10:00'), 'google', 'organic', null, 'mobile'],
  ['fx-s2b', 'fx-v2', ist('2020-03-10 23:30'), 'instagram', 'social', null, 'mobile'],
  ['fx-s2c', 'fx-v2', ist('2020-03-11 00:30'), 'direct', 'none', null, 'desktop'],
  ['fx-s3', 'fx-v3', ist('2020-03-11 10:30'), 'newsletter', 'email', 'c123', 'desktop'],
  ['fx-sb', 'fx-vb', ist('2020-03-10 12:00'), 'google', 'organic', null, 'desktop'],
  ['fx-st', 'fx-vt', ist('2020-03-10 12:00'), 'direct', 'none', null, 'mobile'],
  ['fx-vl', 'fx-vl', ist('2020-03-10 08:00'), 'direct', 'none', null, null],   // imported: session_id = visitor_id
  ['fx-s4', 'fx-v4', ist('2020-03-09 12:00'), 'direct', 'none', null, 'mobile'],
];
const events = [];
function ev(visitor, session, name, at, o = {}) {
  events.push([o.id ?? uuid(), ist(at), visitor, session, name, o.page ?? null, o.pv ?? null, o.product ?? null,
    JSON.stringify(o.props ?? {}), o.bot ?? false, o.migrated ?? false]);
}
// A product page: page_view + product_view (+ engaged reports).
function productPage(visitor, session, at, handle, ms = [], extra = {}) {
  const pv = uuid('a');
  const page = `/products/${handle}`;
  ev(visitor, session, 'page_view', at, { page, pv, id: extra.pvEventId, bot: extra.bot });
  ev(visitor, session, 'product_view', at, { page, pv, product: handle, bot: extra.bot });
  for (const m of ms) ev(visitor, session, 'page_engaged', at, { page, pv, props: { ms: m, scroll: m === 12000 ? 80 : 40 }, bot: extra.bot });
  return { pv, page };
}

const v1tote = productPage('fx-v1', 'fx-s1', '2020-03-10 09:31', 'tote', [5000, 12000], { pvEventId: '11111111-0000-4000-8000-000000000001' });
ev('fx-v1', 'fx-s1', 'page_view', '2020-03-10 09:31', { page: v1tote.page, pv: v1tote.pv, id: '11111111-0000-4000-8000-000000000001' }); // duplicate beacon
for (const i of [0, 1, 1]) ev('fx-v1', 'fx-s1', 'gallery_view', '2020-03-10 09:32', { page: v1tote.page, pv: v1tote.pv, props: { index: i } });
ev('fx-v1', 'fx-s1', 'add_to_cart', '2020-03-10 09:33', { page: v1tote.page, pv: v1tote.pv });
productPage('fx-v1', 'fx-s1', '2020-03-10 09:35', 'clutch', [3000]);
ev('fx-v1', 'fx-s1', 'product_view', '2020-03-10 09:40', { page: '/products/ghost', product: 'ghost', migrated: true });

productPage('fx-v2', 'fx-s2a', '2020-03-01 10:01', 'tote', [8000]);
const p2tote = productPage('fx-v2', 'fx-s2b', '2020-03-10 23:31', 'tote', [20000]);
ev('fx-v2', 'fx-s2b', 'sold_out_view', '2020-03-10 23:31', { page: p2tote.page, pv: p2tote.pv });
const bag3 = productPage('fx-v2', 'fx-s2c', '2020-03-11 00:31', 'bag3', [4000]);
ev('fx-v2', 'fx-s2c', 'add_to_cart', '2020-03-11 00:32', { page: bag3.page, pv: bag3.pv });
const ck = uuid('c');
ev('fx-v2', 'fx-s2c', 'page_view', '2020-03-11 00:33', { page: '/checkout', pv: ck });
ev('fx-v2', 'fx-s2c', 'page_engaged', '2020-03-11 00:40', { page: '/checkout', pv: ck, props: { ms: 6000, scroll: 100 } });
for (const [name, props] of [['checkout_start', {}], ['phone', {}], ['coupon_apply', { code: 'mir10', valid: false }],
  ['payment_start', {}], ['payment_failed', { reason: 'bank_declined' }], ['payment_start', {}], ['payment_success', {}]]) {
  ev('fx-v2', 'fx-s2c', name, '2020-03-11 00:34', { page: '/checkout', pv: ck, props });
}
productPage('fx-v3', 'fx-s3', '2020-03-11 10:31', 'clutch'); // no engaged report

productPage('fx-vb', 'fx-sb', '2020-03-10 12:01', 'tote', [1000], { bot: true });
productPage('fx-vt', 'fx-st', '2020-03-10 12:01', 'tote', [1000]);
ev('fx-vt', 'fx-st', 'add_to_cart', '2020-03-10 12:02', { page: '/products/tote' });
ev('fx-vl', 'fx-vl', 'product_view', '2020-03-10 08:00', { page: '/products/tote', product: 'tote', migrated: true });
ev('fx-v4', 'fx-s4', 'page_view', '2020-03-09 12:00', { page: '/', pv: uuid('d') });

const orders = [
  // id, store, created, person, currency, total, total_inr, items
  ['fx-o1', 'india', ist('2020-03-11 01:00'), '9876543210', 'INR', 15000, 15000, [{ handle: 'tote', title: 'The Tote', quantity: 1, price: '15000.00' }]],
  ['fx-o2', 'global', ist('2020-03-11 11:00'), '9876543210', 'USD', 100, 8300, [{ handle: 'clutch', title: 'The Clutch', quantity: 2, price: '50.00' }]],
  ['fx-o3', 'india', ist('2020-03-10 12:30'), '7000000001', 'INR', 5000, 5000, [{ handle: 'tote', title: 'The Tote', quantity: 1, price: '5000.00' }]],
];

async function seed(c) {
  await c.query(`INSERT INTO people (person_id, phone, first_seen, is_test) VALUES
    ('9876543210', '9876543210', $1, false), ('7000000001', '7000000001', $2, true)`, [ist('2020-03-10 23:35'), ist('2020-03-10 12:00')]);
  for (const [id, person, first, bot] of visitors) {
    await c.query('INSERT INTO visitors (visitor_id, person_id, first_seen, last_seen, is_bot) VALUES ($1,$2,$3,$3,$4)', [id, person, first, bot]);
  }
  for (const [id, v, start, source, medium, campaign, device] of sessions) {
    await c.query(`INSERT INTO sessions (session_id, visitor_id, started_at, last_at, source, medium, campaign, device, is_bot)
      VALUES ($1,$2,$3,$3,$4,$5,$6,$7,$8)`, [id, v, start, source, medium, campaign, device, v === 'fx-vb']);
  }
  for (const r of events) {
    await c.query(`INSERT INTO events (event_id, ts, visitor_id, session_id, name, page, page_view_id, product, props, is_bot, migrated)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11) ON CONFLICT (event_id) DO NOTHING`, r);
  }
  for (const [id, store, created, person, cur, total, inr, items] of orders) {
    await c.query(`INSERT INTO orders (order_id, store, created_at, person_id, currency, total, total_inr, items)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`, [id, store, created, person, cur, total, inr, JSON.stringify(items)]);
  }
  await c.query(`INSERT INTO ad_spend (day, platform, campaign_id, campaign, spend, currency) VALUES ('2020-03-11', 'meta', 'c123', 'Diwali', 1000, 'INR')`);
  await c.query(`INSERT INTO collect_rejects (day, reason, n) VALUES ('2020-03-10', 'bad_event_id', 3)`);
  await c.query(`INSERT INTO legacy_daily (day, source, metric, value) VALUES
    ('2020-03-05', 'funnel_daily', 'visitors', 7), ('2020-03-05', 'funnel_daily', 'p1', 5),
    ('2020-03-05', 'funnel_daily', 'bot_visitors', 3), ('2020-03-05', 'funnel_daily', 'hidden_visitors', 1),
    ('2020-03-05', 'analytics_daily', 'visit', 9)`);
}

const client = new pg.Client({ connectionString: url });
await client.connect();
const run = async (sql, args = []) => (await client.query(sql, args)).rows;
const P = (from, to, o = {}) => ({ from, to, includeBots: false, includeTest: false, by: 'source', model: 'last', ...o });
const v = (m) => m.value;

try {
  await client.query('BEGIN');
  await seed(client);

  // ── Overview ──
  const o = await SECTIONS.overview(run, P('2020-03-10', '2020-03-11'));
  const k = o.kpis;
  assert.equal(v(k.visitors), 2, 'visitors: V1 + P2 (two devices, one person); bot, test, imported out');
  assert.equal(v(k.newVisitors), 1, 'V1 is new; P2 was first seen 1 Mar');
  assert.equal(v(k.returningVisitors), 1);
  assert.equal(v(k.sessions), 4);
  assert.deepEqual([k.engagedSessionRate.num, k.engagedSessionRate.den], [3, 4]);
  assert.equal(v(k.medianEngagedPerSession), 15000, 'median of 15 s (12 s max of repeats + 3 s), 20 s, 10 s');
  assert.equal(k.medianEngagedPerSession.n, 3, 'the visit with no engaged report is left out');
  assert.equal(v(k.orders), 2);
  assert.equal(v(k.revenue), 23300);
  assert.equal(v(k.medianOrderValue), 11650);
  assert.deepEqual([k.conversionRate.num, k.conversionRate.den, k.conversionRate.smallSample], [1, 2, true]);
  assert.deepEqual(o.funnel.map((s) => s.value), [2, 2, 2, 1, 1, 1]);
  assert.equal(o.funnel[3].fromPrevious.value, 0.5);
  assert.equal(v(k.visitors) - 0, 2);
  assert.equal(k.visitors.prev, 1, 'previous period (8–9 Mar): V4');
  assert.deepEqual(o.trend.map((d) => [d.day, d.visitors, d.sessions, d.orders]),
    [['2020-03-10', 2, 2, 0], ['2020-03-11', 1, 2, 2]], 'IST days: 23:30 IST stays on the 10th, 00:30 IST is the 11th');

  const withBots = await SECTIONS.overview(run, P('2020-03-10', '2020-03-11', { includeBots: true }));
  assert.equal(v(withBots.kpis.visitors), 3);
  const withTest = await SECTIONS.overview(run, P('2020-03-10', '2020-03-11', { includeTest: true }));
  assert.equal(v(withTest.kpis.visitors), 3);
  assert.equal(v(withTest.kpis.orders), 3);

  // ── Daily funnel ──
  const fd = await SECTIONS.funnelDaily(run, P('2020-03-10', '2020-03-11'));
  const day = (d) => fd.rows.find((r) => r.day === d);
  assert.deepEqual(fd.rows.map((r) => r.day), ['2020-03-11', '2020-03-10'], 'newest first');
  const d10 = day('2020-03-10'), d11 = day('2020-03-11');
  assert.deepEqual([d10.visitors, d10.newVisitors, d10.returningVisitors, d10.sessions], [2, 1, 1, 2]);
  assert.deepEqual([d10.p1, d10.p2, d10.p3, d10.cart, d10.orders], [1, 1, 0, 1, 0], 'V1: 1st+2nd product, first cart; P2 re-viewed tote');
  assert.deepEqual([d11.visitors, d11.newVisitors, d11.sessions], [1, 0, 2], 'P2 on two devices = one visitor');
  assert.deepEqual([d11.p1, d11.p2, d11.p3, d11.cart, d11.checkoutStart, d11.phone, d11.paymentStart],
    [0, 1, 1, 1, 1, 1, 1], 'P2 had seen tote before: bag3 + clutch take them to 2nd and 3rd');
  assert.deepEqual([d11.orders, d11.revenueInr], [2, 23300]);
  assert.equal(fd.totals.find((m) => m.key === 'p2').value, 2);

  const legacy = await SECTIONS.funnelDaily(run, P('2020-03-05', '2020-03-05'));
  const l5 = legacy.rows[0];
  assert.deepEqual([l5.legacy, l5.visitors, l5.newVisitors, l5.sessions, l5.p1, l5.checkoutStart], [true, null, 7, 9, 5, null]);
  const legacyBots = await SECTIONS.funnelDaily(run, P('2020-03-05', '2020-03-05', { includeBots: true, includeTest: true }));
  assert.equal(legacyBots.rows[0].newVisitors, 11, 'bot_ and hidden_ buckets join when switched on');

  // ── Products ──
  const pr = await SECTIONS.products(run, P('2020-03-10', '2020-03-11'));
  const prod = (h) => pr.table.rows.find((r) => r.key.value === h);
  assert.equal(prod('ghost'), undefined, 'migrated events never count');
  const tote = prod('tote').cells;
  assert.deepEqual([tote.views.value, tote.viewers.value], [2, 2], 'duplicate page_view counted once; bot/test out');
  assert.equal(tote.medianEngagedMs.value, 16000, 'median of 12 s (max of repeats) and 20 s');
  assert.equal(tote.medianGalleryDepth.value, 1, 'photos 0,1,1 → 2 on one view, 0 on the other');
  assert.deepEqual([tote.addToCartRate.num, tote.addToCartRate.den], [1, 2]);
  assert.deepEqual([tote.orders.value, tote.units.value, tote.revenue.value, tote.soldOutViews.value], [1, 1, 15000, 1]);
  assert.equal(prod('tote').label, 'The Tote');
  const clutch = prod('clutch').cells;
  assert.deepEqual([clutch.views.value, clutch.medianEngagedMs.value, clutch.medianEngagedMs.n], [2, 3000, 1]);
  assert.deepEqual([clutch.units.value, clutch.revenue.value], [2, 8300], 'USD line converted at the order rate');
  assert.equal(prod('bag3').cells.addToCartRate.value, 1);

  // ── Acquisition ──
  const acq = await SECTIONS.acquisition(run, P('2020-03-10', '2020-03-11'));
  const src = (s) => acq.table.rows.find((r) => r.key.source === s)?.cells;
  assert.deepEqual([src('direct').sessions.value, src('direct').visitors.value, src('direct').leads.value,
    src('direct').orders.value, src('direct').revenue.value], [2, 2, 1, 1, 15000], 'O1 last touch = the 00:30 direct visit');
  assert.deepEqual([src('newsletter').orders.value, src('newsletter').revenue.value], [1, 8300], 'O2 last touch = the new device');
  assert.equal(src('instagram').orders.value, 0);
  assert.equal(src('google'), undefined, 'bot visit out; google only first-touched');
  const first = await SECTIONS.acquisition(run, P('2020-03-10', '2020-03-11', { model: 'first' }));
  const g = first.table.rows.find((r) => r.key.source === 'google').cells;
  assert.deepEqual([g.sessions.value, g.orders.value, g.revenue.value], [0, 2, 23300], 'first touch = 1 Mar google visit');
  const camp = await SECTIONS.acquisition(run, P('2020-03-10', '2020-03-11', { by: 'campaign' }));
  const diwali = camp.table.rows.find((r) => r.key.campaign === 'diwali').cells;
  assert.deepEqual([diwali.sessions.value, diwali.orders.value, diwali.spend.value, diwali.costPerSale.value, diwali.roas.value],
    [1, 1, 1000, 1000, 8.3], 'utm_campaign c123 = the Meta campaign id → its name');
  assert.equal(camp.spendAvailable, true);

  // ── Checkout ──
  const co = await SECTIONS.checkout(run, P('2020-03-10', '2020-03-11'));
  const st = Object.fromEntries(co.steps.map((s) => [s.key, s.value]));
  assert.deepEqual([st.add_to_cart, st.checkout_start, st.phone, st.payment_start, st.payment_success, st.order], [2, 1, 1, 1, 1, 1]);
  assert.deepEqual([co.kpis.paymentFailureRate.num, co.kpis.paymentFailureRate.den], [1, 1]);
  assert.equal(co.paymentFailures.rows[0].key.value, 'bank_declined');
  assert.deepEqual([co.coupons.rows[0].key.value, co.coupons.rows[0].cells.invalid.value], ['MIR10', 1]);

  // ── Audience ──
  const au = await SECTIONS.audience(run, P('2020-03-10', '2020-03-11'));
  const dev = (x) => au.own.device.rows.find((r) => r.key.value === x).cells;
  assert.deepEqual([dev('mobile').visitors.value, dev('mobile').buyers.value, dev('desktop').visitors.value], [2, 1, 1]);
  assert.equal(au.ga.age.available, false);
  assert.match(au.ga.age.note, /not enough data/i);

  // ── Retention ──
  const re = await SECTIONS.retention(run, P('2020-03-10', '2020-03-11'));
  assert.deepEqual([re.kpis.returningVisitorShare.num, re.kpis.returningVisitorShare.den], [1, 2]);
  assert.deepEqual([re.kpis.repeatPurchaseRate.num, re.kpis.repeatPurchaseRate.den], [1, 1], 'O2 is P2\'s second order');
  assert.equal(re.kpis.medianDaysToFirstOrder.value, 9.625, '1 Mar 10:00 IST → 11 Mar 01:00 IST');
  assert.equal(re.kpis.medianSessionsToFirstOrder.value, 3);
  assert.deepEqual(re.cohorts.map((c) => [c.cohortWeek, c.size, c.weeks[0].active.num]), [['2020-03-09', 2, 2]], 'V1 + V4, week of Mon 9 Mar');

  // ── Tracking health ──
  const th = await SECTIONS.trackingHealth(run, P('2020-03-10', '2020-03-10'));
  const h10 = th.days[0];
  assert.equal(h10.rejects, 3);
  assert.equal(h10.botEvents, 3, 'the crawler\'s page_view, product_view, page_engaged');
  assert.equal(h10.orders, 1, 'O3 (test) placed 10 Mar; O1 is 01:00 IST on the 11th');
  assert.equal(h10.pageViews, 5, 'V1 tote (duplicate dropped) + clutch, P2 at 23:31 IST, VB, VT; P2 at 00:31 IST is the 11th');

  console.log('metrics: SQL checks passed');
} finally {
  await client.query('ROLLBACK').catch(() => {});
  await client.end();
}
