// SAMPLE DATA for design review. Only used behind the ?demo=1 flag, and the UI labels
// it "Sample data". None of these numbers describe the real shop.
//
// Built in the metrics API's own shapes (src/lib/metrics/types.ts) with the API's own
// definitions (DEFS), so demo mode exercises exactly the code real mode runs.
import { DEFS, type DefKey } from '~/lib/metrics/definitions';
import type {
  AcquisitionResponse, AudienceResponse, Cell, CheckoutResponse, Column, FunnelDailyResponse, FunnelDayRow,
  FunnelStep, Metric, OverviewResponse, PeopleQuery, ProductsResponse, RetentionResponse, SectionMeta, Table,
  TrackingHealthResponse, ValueKey,
} from './types';
import type { AcqOpts } from './data';
import { addDays, daysBetween } from './format';

const meta = <S extends SectionMeta['section']>(section: S, from: string, to: string, notes: string[] = []) => {
  const days = daysBetween(from, to) + 1;
  const prevTo = addDays(from, -1);
  return {
    section, period: { from, to, days }, previous: { from: addDays(prevTo, -(days - 1)), to: prevTo, days },
    filters: { includeBots: false, includeTest: false }, generatedAt: new Date().toISOString(),
    notes: ['Sample data for design review.', ...notes],
  };
};
const count = (value: number, prev: number): Cell => ({ value, prev, smallSample: false });
const rate = (n: number, d: number, pn: number, pd: number): Cell =>
  ({ value: d ? n / d : null, num: n, den: d, prev: pd ? pn / pd : null, prevNum: pn, prevDen: pd, smallSample: d < 30 });
const median = (value: number, n: number, prev: number): Cell => ({ value, n, prev, smallSample: n < 30 });
const metric = (key: string, def: DefKey, c: Cell): Metric => ({ key, label: DEFS[def].label, unit: DEFS[def].unit, definition: DEFS[def].definition, ...c });
const column = (key: string, def: DefKey): Column => ({ key, label: DEFS[def].label, unit: DEFS[def].unit, definition: DEFS[def].definition });
const step = (key: string, def: DefKey, v: number, p: number, before?: [number, number]): FunnelStep =>
  ({ ...metric(key, def, count(v, p)), fromPrevious: before ? rate(v, before[0], p, before[1]) : null });
const scale = (from: string, to: string) => Math.max(0.05, (daysBetween(from, to) + 1) / 30);
const r = (v: number, k: number) => Math.round(v * k);

export function demoOverview(from: string, to: string): OverviewResponse {
  const k = scale(from, to);
  const V = r(12840, k), pV = r(11464, k);
  const days: OverviewResponse['trend'] = [];
  const n = daysBetween(from, to) + 1;
  for (let i = 0; i < n; i++) {
    const day = addDays(from, i);
    const wave = 0.75 + 0.5 * (i / Math.max(n - 1, 1)) + 0.18 * Math.sin(i * 0.9);
    days.push({ day, legacy: i < 3 && n > 20, visitors: i < 3 && n > 20 ? null : Math.round(420 * wave), sessions: i < 3 && n > 20 ? null : Math.round(560 * wave), orders: Math.max(0, Math.round(5.4 * wave + Math.cos(i * 2.1))), revenueInr: Math.round(71000 * wave + 15000 * Math.cos(i * 1.7)) });
  }
  return {
    ...meta('overview', from, to),
    section: 'overview',
    kpis: {
      visitors: metric('visitors', 'visitors', count(V, pV)),
      newVisitors: metric('newVisitors', 'newVisitors', count(r(8860, k), r(8240, k))),
      returningVisitors: metric('returningVisitors', 'returningVisitors', count(r(3980, k), r(3224, k))),
      sessions: metric('sessions', 'sessions', count(r(17120, k), r(15010, k))),
      engagedSessionRate: metric('engagedSessionRate', 'engagedSessionRate', rate(r(9930, k), r(17120, k), r(8406, k), r(15010, k))),
      medianEngagedPerSession: metric('medianEngagedPerSession', 'medianEngagedPerSession', median(94000, r(15200, k), 88000)),
      orders: metric('orders', 'orders', count(r(164, k), r(150, k))),
      revenue: metric('revenue', 'revenue', count(r(2140000, k), r(1877000, k))),
      medianOrderValue: metric('medianOrderValue', 'medianOrderValue', median(11900, r(164, k), 11400)),
      conversionRate: metric('conversionRate', 'conversionRate', rate(r(164, k), V, r(150, k), pV)),
    },
    funnel: [
      step('visitors', 'visitors', V, pV),
      step('viewedProduct', 'viewedProduct', r(8120, k), r(7300, k), [V, pV]),
      step('addedToCart', 'addedToCart', r(822, k), r(790, k), [r(8120, k), r(7300, k)]),
      step('startedCheckout', 'startedCheckout', r(392, k), r(360, k), [r(822, k), r(790, k)]),
      step('startedPayment', 'startedPayment', r(231, k), r(214, k), [r(392, k), r(360, k)]),
      step('ordered', 'ordered', r(164, k), r(150, k), [r(231, k), r(214, k)]),
    ],
    trend: days,
  };
}

function tbl<K>(columns: Column[], rows: { key: K; label: string; cells: Record<string, Cell> }[]): Table<K> { return { columns, rows }; }

export function demoAcquisition(from: string, to: string, a: AcqOpts): AcquisitionResponse {
  const k = scale(from, to);
  const spendCols = a.by === 'campaign' || a.by === 'content';
  const columns = [
    column('sessions', 'sessions'), column('visitors', 'visitors'), column('leads', 'leads'), column('leadRate', 'leadRate'),
    column('orders', a.model === 'first' ? 'attributedOrdersFirst' : 'attributedOrdersLast'), column('revenue', 'attributedRevenue'),
    column('conversionRate', 'channelConversion'),
    ...(spendCols ? [column('spend', 'spend'), column('costPerSale', 'costPerSale'), column('roas', 'roas')] : []),
  ];
  const base: [Record<string, string>, string, number, number, number, number, number | null][] = a.by === 'campaign' || a.by === 'content'
    ? [[{ source: 'instagram', campaign: 'reel-1' }, 'instagram / reel-1', 2900, 31, 402000, 140, 19200], [{ source: 'instagram', campaign: 'wedding-edit' }, 'instagram / wedding-edit', 2750, 30, 388000, 120, 18700], [{ source: 'google', campaign: 'brand-search' }, 'google / brand-search', 2300, 33, 410000, 160, 13500], [{ source: '(unattributed)' }, '(unattributed)', 0, 9, 98000, 0, null]]
    : [[{ source: 'instagram' }, 'instagram', 5400, 61, 790000, 260, null], [{ source: 'google' }, 'google', 4100, 47, 580000, 190, null], [{ source: 'direct' }, 'direct', 3150, 33, 410000, 120, null], [{ source: 'affiliate' }, 'affiliate', 820, 14, 190000, 40, null], [{ source: '(unattributed)' }, '(unattributed)', 0, 9, 170000, 0, null]];
  const rows = base.map(([key, label, sess, orders, rev, leads, spend]) => {
    const visitors = Math.round(sess * 0.76 * k), s = Math.round(sess * k), o = Math.round(orders * k), l = Math.round(leads * k);
    const cells: Record<string, Cell> = {
      sessions: count(s, Math.round(s * 0.9)), visitors: count(visitors, Math.round(visitors * 0.92)), leads: count(l, Math.round(l * 0.85)),
      leadRate: rate(l, visitors, Math.round(l * 0.85), Math.round(visitors * 0.92)), orders: count(o, Math.round(o * 0.9)),
      revenue: count(Math.round(rev * k), Math.round(rev * k * 0.88)), conversionRate: rate(o, s, Math.round(o * 0.9), Math.round(s * 0.9)),
    };
    if (spendCols) {
      const sp = spend == null ? null : Math.round(spend * k);
      cells.spend = { value: sp, prev: sp == null ? null : Math.round(sp * 1.1), smallSample: false };
      cells.costPerSale = { value: sp != null && o ? sp / o : null, prev: null, smallSample: false };
      cells.roas = { value: sp ? (rev * k) / sp : null, prev: null, smallSample: false };
    }
    return { key, label, cells };
  });
  return { ...meta('acquisition', from, to), section: 'acquisition', by: a.by, model: a.model, spendAvailable: spendCols, table: tbl(columns, rows) };
}

export function demoProducts(from: string, to: string): ProductsResponse {
  const k = scale(from, to);
  const columns = [column('views', 'productViews'), column('viewers', 'productViewers'), column('medianEngagedMs', 'productEngaged'),
    column('medianGalleryDepth', 'galleryDepth'), column('medianScroll', 'scrollDepth'), column('addToCartRate', 'addToCartRate'),
    column('orders', 'productOrders'), column('units', 'units'), column('revenue', 'productRevenue'), column('soldOutViews', 'soldOutViews')];
  const p: [string, string, number, number, number, number, number, number][] = [
    ['tote-rust', 'Tote · Rust', 2120, 1450, 74000, 160, 38, 212], ['tote-ink', 'Tote · Ink', 1980, 1380, 68000, 171, 44, 0],
    ['satchel-ink', 'Satchel · Ink', 960, 700, 52000, 33, 6, 96], ['clutch-sand', 'Clutch · Sand', 870, 640, 49000, 71, 21, 0],
    ['crossbody-cocoa', 'Crossbody · Cocoa', 640, 480, 83000, 20, 3, 0], ['mini-pouch', 'Mini pouch', 40, 22, 30000, 3, 1, 0],
  ];
  return {
    ...meta('products', from, to), section: 'products',
    table: tbl(columns, p.map(([h, t, v, vw, ms, carts, orders, so]) => {
      const views = r(v, k), viewers = r(vw, k), c = r(carts, k), o = r(orders, k);
      return { key: { value: h }, label: t, cells: {
        views: count(views, r(views, 0.9)), viewers: count(viewers, r(viewers, 0.9)), medianEngagedMs: median(ms, viewers, ms * 0.95),
        medianGalleryDepth: median(4, viewers, 4), medianScroll: median(62, viewers, 58), addToCartRate: rate(c, viewers, r(c, 0.9), r(viewers, 0.9)),
        orders: count(o, r(o, 0.9)), units: count(o, r(o, 0.9)), revenue: count(o * 11900, r(o * 11900, 0.9)), soldOutViews: count(r(so, k), r(so, k * 0.7)),
      } };
    })),
  };
}

export function demoCheckout(from: string, to: string): CheckoutResponse {
  const k = scale(from, to);
  const S: [string, DefKey, number][] = [['add_to_cart', 'ckCart', 822], ['checkout_start', 'ckStart', 392], ['otp_sent', 'ckOtpSent', 360], ['otp_verified', 'ckOtpVerified', 330], ['phone', 'ckPhone', 330], ['address', 'ckAddress', 290], ['payment_method', 'ckMethod', 270], ['payment_start', 'ckPayment', 260], ['payment_success', 'ckPaid', 168], ['order', 'ckOrdered', 164]];
  const steps = S.map(([key, def, v], i) => step(key, def, r(v, k), r(v * 0.93, k), i ? [r(S[i - 1][2], k), r(S[i - 1][2] * 0.93, k)] : undefined));
  const brk = (rows: [string, number, number][]): Table<ValueKey> => {
    const tot = rows.reduce((s, x) => s + x[1], 0);
    return tbl([column('events', 'events'), column('people', 'people'), column('share', 'share')], rows.map(([key, e, p]) => ({ key: { value: key }, label: key, cells: { events: count(r(e, k), r(e * 1.2, k)), people: count(r(p, k), r(p * 1.2, k)), share: rate(r(e, k), r(tot, k), r(e * 1.2, k), r(tot * 1.2, k)) } })));
  };
  return {
    ...meta('checkout', from, to, ['Steps count different people. Not every step is sent by every checkout yet; a step at 0 may simply not be tracked.']),
    section: 'checkout', steps,
    kpis: { otpFailureRate: metric('otpFailureRate', 'otpFailureRate', rate(r(24, k), r(360, k), r(30, k), r(335, k))), paymentFailureRate: metric('paymentFailureRate', 'paymentFailureRate', rate(r(29, k), r(260, k), r(34, k), r(242, k))) },
    otpFailures: brk([['expired', 15, 14], ['wrong_code', 11, 10]]),
    paymentFailures: brk([['UPI declined', 14, 12], ['Card failed', 9, 8], ['Cancelled by user', 6, 6]]),
    paymentMethods: brk([['upi', 160, 150], ['card', 80, 72], ['cod', 30, 30]]),
    coupons: tbl([column('tries', 'couponTries'), column('valid', 'couponValid'), column('invalid', 'couponInvalid')], [{ key: { value: 'WELCOME10' }, label: 'WELCOME10', cells: { tries: count(r(44, k), r(40, k)), valid: count(r(40, k), r(36, k)), invalid: count(r(4, k), r(4, k)) } }]),
  };
}

export function demoAudience(from: string, to: string): AudienceResponse {
  const k = scale(from, to);
  const own = (rows: [string, number, number][]): Table<ValueKey> => {
    const tot = rows.reduce((s, x) => s + x[1], 0);
    return tbl([column('visitors', 'audienceVisitors'), column('share', 'audienceShare'), column('sessions', 'sessions'), column('medianEngagedMs', 'medianEngagedPerSession'), column('buyers', 'audienceBuyers'), column('conversionRate', 'audienceConversion')],
      rows.map(([v, n, b]) => ({ key: { value: v }, label: v, cells: { visitors: count(r(n, k), r(n * 0.9, k)), share: rate(r(n, k), r(tot, k), r(n * 0.9, k), r(tot * 0.9, k)), sessions: count(r(n * 1.3, k), r(n * 1.2, k)), medianEngagedMs: median(90000, r(n, k), 85000), buyers: count(r(b, k), r(b * 0.9, k)), conversionRate: rate(r(b, k), r(n, k), r(b * 0.9, k), r(n * 0.9, k)) } })));
  };
  const ga = (rows: [string, number][] | null) => ({
    available: !!rows, note: rows ? null : 'Not enough data — Google hides groups too small to keep people anonymous.',
    table: tbl([column('users', 'gaUsers'), column('share', 'gaShare'), column('sessions', 'gaSessions'), column('conversions', 'gaConversions')],
      (rows || []).map(([v, n]) => ({ key: { value: v }, label: v, cells: { users: count(r(n, k), r(n * 0.9, k)), share: rate(n, 1000, n * 0.9, 900), sessions: count(r(n * 1.4, k), r(n * 1.3, k)), conversions: count(r(n / 30, k), r(n / 32, k)) } }))),
  });
  return {
    ...meta('audience', from, to), section: 'audience',
    own: {
      device: own([['mobile', 9500, 86], ['desktop', 2820, 68], ['tablet', 520, 10]]),
      os: own([['iOS', 5800, 70], ['Android', 3700, 26], ['macOS', 1700, 48], ['Windows', 1120, 20]]),
      browser: own([['Safari', 5900, 72], ['Chrome', 5600, 80], ['Instagram in-app', 900, 6], ['Other', 440, 6]]),
      city: own([['Mumbai', 2910, 61], ['Delhi', 1980, 32], ['Bengaluru', 1640, 24], ['Pune', 890, 13], ['Hyderabad', 720, 9]]),
      country: own([['IN', 11800, 152], ['AE', 420, 6], ['US', 310, 4], ['GB', 190, 2]]),
    },
    ga: { age: ga([['18-24', 90], ['25-34', 380], ['35-44', 290], ['45-54', 160], ['55+', 80]]), gender: ga([['female', 710], ['male', 270]]), interest: ga(null) },
  };
}

export function demoRetention(from: string, to: string): RetentionResponse {
  const cohorts: RetentionResponse['cohorts'] = [];
  const n = Math.min(8, Math.max(1, Math.round((daysBetween(from, to) + 1) / 7)));
  for (let i = 0; i < n; i++) {
    const size = 1100 + i * 60;
    const elapsed = n - i;
    const weeks = [];
    for (let w = 0; w <= Math.min(12, elapsed - 1); w++) {
      const act = w === 0 ? size : Math.round(size * (0.26 / (w + 0.6)));
      const buy = Math.round(size * (w === 0 ? 0.008 : 0.004 / w));
      weeks.push({ weeksSince: w, active: rate(act, size, 0, 0), buyers: rate(buy, size, 0, 0) });
      weeks[weeks.length - 1].active.prev = null; weeks[weeks.length - 1].buyers.prev = null;
    }
    cohorts.push({ cohortWeek: addDays(from, i * 7), size, weeks });
  }
  return {
    ...meta('retention', from, to), section: 'retention',
    kpis: {
      returningVisitorShare: metric('returningVisitorShare', 'returningVisitorShare', rate(3980, 12840, 3224, 11464)),
      repeatPurchaseRate: metric('repeatPurchaseRate', 'repeatPurchaseRate', rate(23, 164, 18, 150)),
      medianDaysToFirstOrder: metric('medianDaysToFirstOrder', 'medianDaysToFirstOrder', median(6, 141, 7)),
      medianSessionsToFirstOrder: metric('medianSessionsToFirstOrder', 'medianSessionsToFirstOrder', median(2, 141, 2)),
    },
    cohorts,
  };
}

export function demoFunnelDaily(from: string, to: string): FunnelDailyResponse {
  const COLS: [keyof FunnelDayRow, DefKey][] = [['visitors', 'fdVisitors'], ['newVisitors', 'fdNewVisitors'], ['returningVisitors', 'fdReturning'], ['sessions', 'fdSessions'], ['p1', 'fdP1'], ['p2', 'fdP2'], ['p3', 'fdP3'], ['cart', 'fdCart'], ['checkoutStart', 'fdCheckout'], ['phone', 'fdPhone'], ['address', 'fdAddress'], ['paymentStart', 'fdPayment'], ['orders', 'fdOrders'], ['revenueInr', 'fdRevenue']];
  const rows: FunnelDayRow[] = [];
  const n = daysBetween(from, to) + 1;
  for (let i = n - 1; i >= 0; i--) {
    const day = addDays(from, i), legacy = i < 5;
    const w = 0.8 + 0.3 * Math.sin(i);
    const v = Math.round(420 * w);
    rows.push({ day, legacy, visitors: legacy ? null : v, newVisitors: Math.round(v * 0.7), returningVisitors: legacy ? null : Math.round(v * 0.3), sessions: Math.round(v * 1.3), p1: Math.round(v * 0.5), p2: Math.round(v * 0.22), p3: Math.round(v * 0.1), cart: Math.round(v * 0.065), checkoutStart: legacy ? null : Math.round(v * 0.03), phone: Math.round(v * 0.032), address: Math.round(v * 0.025), paymentStart: legacy ? null : Math.round(v * 0.018), orders: Math.round(v * 0.013), revenueInr: Math.round(v * 0.013) * 11900 });
  }
  const ADD = new Set(['sessions', 'p1', 'p2', 'p3', 'cart', 'checkoutStart', 'phone', 'address', 'paymentStart', 'orders', 'revenueInr']);
  const tot = (key: keyof FunnelDayRow) => rows.reduce((s, x) => s + (typeof x[key] === 'number' ? (x[key] as number) : 0), 0);
  return {
    ...meta('funnelDaily', from, to, ['Milestone columns count each person once, on the day they first reached that step, so they add up across days.', 'Days before the event log come from the old Firestore counters (legacy) and lack some columns.']),
    section: 'funnelDaily', columns: COLS.map(([key, d]) => column(key, d)), rows,
    totals: COLS.filter(([key]) => ADD.has(key)).map(([key, d]) => metric(key, d, count(tot(key), Math.round(tot(key) * 0.9)))),
  };
}

export function demoTrackingHealth(from: string, to: string): TrackingHealthResponse {
  const n = daysBetween(from, to) + 1;
  const days = Array.from({ length: n }, (_, i) => ({ day: addDays(to, -i), events: 5200, botEvents: 400, pageViews: 1900, rejects: 3, orders: 5 }));
  const e = 5200 * n;
  return {
    ...meta('trackingHealth', from, to, ['Orders per day should match Shopify exactly; a gap means a webhook was missed.']), section: 'trackingHealth',
    kpis: {
      events: metric('events', 'healthEvents', count(e, e * 0.95)),
      rejectRate: metric('rejectRate', 'healthRejectRate', rate(3 * n, e + 3 * n, 4 * n, e + 4 * n)),
      botShare: metric('botShare', 'healthBotShare', rate(400 * n, e, 380 * n, e * 0.95)),
      daysWithoutPageViews: metric('daysWithoutPageViews', 'healthNoPageViews', count(0, 0)),
    },
    days, rejectReasons: { columns: [column('n', 'healthRejects')], rows: [] }, eventNames: { columns: [column('n', 'healthEvents')], rows: [] },
  };
}


// The People + inbox fixtures are in the API's own raw shapes (people.ts, inbox.ts), so
// demo mode runs the same mapping code as real mode.
const hAgo = (h: number) => new Date(Date.now() - h * 3600e3).toISOString();
const OUT_LEAD = ['contacted', 'no_answer', 'ordered', 'not_interested'];

export function demoInboxRaw(): any {
  const lead = (i: number, name: string, city: string, score: number, reason: string, cart: number | null, phone: boolean) => ({
    kind: 'hot_lead', ref: 'demo-p' + i, title: `${name} · score ${score}`, reason, value: cart, currency: cart ? 'INR' : null,
    whatsapp: phone ? 'https://wa.me/910000000000?text=Hi%2C%20this%20is%20Mir%20Kash.' : null,
    created_at: hAgo(i), person_id: 'demo-p' + i, priority: 200 + score, outcomes: OUT_LEAD, _city: city,
  });
  const leads = [
    lead(1, 'Priya S.', 'Mumbai', 92, '₹18.4k cart · 3rd visit · gave phone yesterday', 18400, true),
    lead(2, 'Aanya K.', 'Pune', 86, '₹12.9k cart · 2nd visit · reached checkout', 12900, true),
    lead(3, 'Ritika M.', 'Delhi', 78, '₹9.8k cart · 4th visit · 12 min browsing', 9800, true),
    lead(4, 'Sneha P.', 'Bengaluru', 74, '₹21k cart · 2nd visit · gave phone today', 21000, true),
    lead(5, 'Kavya J.', 'Hyderabad', 71, '₹15k cart · started Try at Home', 15000, true),
    lead(6, 'Ira B.', 'Mumbai', 66, '₹8.5k cart · 3rd visit', 8500, true),
    lead(7, 'Meher T.', 'Pune', 63, '₹6k cart · gave phone 3 days ago', 6000, true),
    lead(8, 'Nisha G.', 'Chennai', 60, '₹11k cart · reached checkout', 11000, true),
    lead(9, 'Diya R.', 'Kolkata', 57, '₹4.5k cart · 2nd visit · gave phone', 4500, true),
    lead(10, 'Anika V.', 'Jaipur', 55, '₹13k cart · 2nd visit', 13000, true),
    lead(11, 'Pooja L.', 'Mumbai', 53, '₹7k cart · gave phone', 7000, true),
    lead(12, 'Zara Q.', 'Delhi', 51, '₹5k cart · 3rd visit', 5000, true),
  ];
  const items = [
    { kind: 'payment_failed', ref: 'demo-p20', title: 'Neha R. · payment failed', reason: '₹9.8k cart · “UPI declined” · 2 hours ago', value: 9800, currency: 'INR', whatsapp: 'https://wa.me/910000000000', created_at: hAgo(2), person_id: 'demo-p20', priority: 409, outcomes: OUT_LEAD },
    { kind: 'payment_failed', ref: 'gid://shopify/DraftOrder/demo', title: 'Isha M. · payment not completed', reason: '₹14.2k order · Tote Rust · left yesterday', value: 14200, currency: 'INR', whatsapp: 'https://wa.me/910000000000', created_at: hAgo(26), person_id: null, priority: 414, outcomes: OUT_LEAD },
    { kind: 'booking_confirm', ref: 'demo-b1', title: 'Confirm Try at Home · Riya D. · tomorrow', reason: 'tomorrow · 4–6 pm · 2 bags · Mumbai', value: null, currency: null, whatsapp: 'https://wa.me/910000000000', created_at: hAgo(30), person_id: 'demo-p5', priority: 300, outcomes: ['confirmed', 'completed', 'no_show', 'cancelled'] },
    { kind: 'booking_confirm', ref: 'demo-b2', title: "How did Meera P.'s Try at Home go?", reason: 'was 19 Oct · 11 am · 1 bag · Mumbai', value: null, currency: null, whatsapp: null, created_at: hAgo(80), person_id: null, priority: 370, outcomes: ['confirmed', 'completed', 'no_show', 'cancelled'] },
    ...leads,
    { kind: 'restock', ref: 'tote', title: 'Restock tote (Rust)', reason: '41 people looked while sold out · 212 views in 30 days · 9 we can message', value: null, currency: null, whatsapp: null, created_at: hAgo(3), person_id: null, priority: 141, outcomes: ['restocking', 'not_restocking'] },
  ];
  return { as_of: new Date().toISOString(), hot_threshold: 50, counts: {}, items };
}

const DEMO_PEOPLE: any[] = [
  { id: 'demo-p1', kind: 'person', name: 'Priya S.', phone: '+919800004821', city: 'Mumbai', stage: 'cart', visits: 3, returning: true, first_touch: { source: 'instagram', medium: 'paid_social', campaign: 'reel-1' }, last_touch: { source: 'direct' }, device: 'mobile', engaged_ms: 660000, cart_value: 18400, score: 92, reason: '₹18.4k cart · 3rd visit · gave phone yesterday', orders: 0, products: ['tote-rust', 'tote-ink'] },
  { id: 'demo-p2', kind: 'person', name: 'Aanya K.', phone: '+919900001207', city: 'Pune', stage: 'payment', visits: 2, returning: true, first_touch: { source: 'google', medium: 'organic' }, last_touch: { source: 'google', medium: 'organic' }, device: 'mobile', engaged_ms: 540000, cart_value: 12900, score: 86, reason: '₹12.9k cart · 2nd visit · reached checkout', orders: 0 },
  { id: 'demo-p20', kind: 'person', name: 'Neha R.', phone: '+919800007733', city: 'Delhi', stage: 'payment', visits: 1, returning: false, first_touch: { source: 'direct' }, last_touch: { source: 'direct' }, device: 'desktop', engaged_ms: 360000, cart_value: 9800, score: 74, reason: '₹9.8k cart · reached checkout', orders: 0 },
  { id: 'v:demo-anon', kind: 'visitor', name: null, city: 'Delhi', stage: 'viewed', visits: 2, returning: true, first_touch: { source: 'instagram', medium: 'paid_social' }, last_touch: { source: 'instagram' }, device: 'mobile', engaged_ms: 480000, cart_value: null, score: 31, reason: '2nd visit · viewed 4 bags', orders: 0 },
  { id: 'demo-p5', kind: 'person', name: 'Riya D.', phone: '+919700005590', city: 'Mumbai', stage: 'ordered', visits: 4, returning: true, first_touch: { source: 'affiliate', campaign: 'priya' }, last_touch: { source: 'direct' }, device: 'mobile', engaged_ms: 1320000, cart_value: 21000, score: null, reason: 'Already ordered', orders: 1, ltv: 21000 },
  { id: 'v:demo-anon2', kind: 'visitor', name: null, city: 'Bengaluru', stage: 'viewed', visits: 1, returning: false, first_touch: { source: 'google', medium: 'organic' }, last_touch: { source: 'google' }, device: 'mobile', engaged_ms: 60000, cart_value: null, score: 4, reason: 'Browsed once', orders: 0 },
].map((r, i) => ({ email: null, country: 'IN', first_seen: hAgo(200 - i * 20), last_seen: hAgo(i + 1), products: [], ltv: 0, bookings: 0, is_bot: false, is_test: false, whatsapp: r.phone ? 'https://wa.me/' + String(r.phone).slice(1) : null, ...r }));

export function demoPeopleRaw(pq: PeopleQuery): any {
  let rows = DEMO_PEOPLE.slice();
  if (pq.stage === 'returning') rows = rows.filter((r) => r.returning);
  else if (pq.stage && pq.stage !== 'all') rows = rows.filter((r) => r.stage === pq.stage);
  if (pq.device) rows = rows.filter((r) => r.device === pq.device!.toLowerCase());
  if (pq.q) {
    const s = pq.q.toLowerCase();
    rows = rows.filter((r) => [r.name, r.phone, r.city, r.first_touch.source, r.first_touch.campaign].join(' ').toLowerCase().includes(s));
  }
  return { as_of: new Date().toISOString(), page: 1, size: 50, pages: 1, count: rows.length, returning: rows.filter((r) => r.returning).length, total: DEMO_PEOPLE.length, rows };
}

export function demoPersonRaw(id: string): any | null {
  const summary = DEMO_PEOPLE.find((r) => r.id === id);
  if (!summary) return null;
  const v = (n: number, h: number, source: string, extra: any = {}) => ({ type: 'visit', ts: hAgo(h), visit: n, source, device: 'mobile', city: summary.city, ...extra });
  const e = (name: string, h: number, extra: any = {}) => ({ type: 'event', ts: hAgo(h), name, ...extra });
  return {
    as_of: new Date().toISOString(), id, summary,
    person: summary.kind === 'person' ? { person_id: id, name: summary.name, phone: summary.phone, email: null, address1: null, city: summary.city, province: null, pin: null, first_seen: summary.first_seen, whatsapp: summary.whatsapp } : null,
    visitors: [],
    actions: [],
    counts: { visits: 3, events: 9, orders: summary.orders, bookings: 0 },
    timeline: [
      v(1, 300, 'instagram', { campaign: 'reel-1', landing: '/products/tote' }),
      e('page_view', 300, { page_view_id: 'a' }), e('product_view', 299.9, { product: 'tote-rust' }), e('product_view', 299.8, { product: 'tote-ink' }),
      e('page_engaged', 299.7, { page_view_id: 'a', props: { ms: 180000 } }),
      v(2, 26, 'google', { medium: 'organic' }),
      e('page_view', 26, { page_view_id: 'b' }), e('gallery_zoom', 25.9, { product: 'tote-rust' }), e('section_open', 25.8, { product: 'tote-rust', props: { section: 'materials' } }),
      e('checkout_start', 25.5), e('phone', 25.4), e('payment_failed', 25.3, { props: { reason: 'UPI declined' } }),
      v(3, 2, 'direct'),
      e('add_to_cart', 1.9, { product: 'tote-rust', value: 18400, currency: 'INR' }),
    ],
  };
}

// Small operations sample so the carried-over views render in demo mode.
export function demoLegacy(): Record<string, unknown> {
  const now = Date.now();
  const iso = (d: number) => new Date(now - d * 864e5).toISOString();
  return {
    orders: [
      { id: 'o1', name: '#1042', customer: 'Riya D.', email: 'riya@example.com', phone: '+91 97000 05590', createdAt: iso(1), total: { amount: '21000', currencyCode: 'INR' }, items: '1× Tote · Rust', financial: 'PAID', fulfillment: 'UNFULFILLED', paymentMethod: 'cashfree', cancelled: false },
      { id: 'o2', name: '#1041', customer: 'Sana H.', email: 'sana@example.com', phone: '+91 98000 11111', createdAt: iso(3), total: { amount: '11900', currencyCode: 'INR' }, items: '1× Clutch · Sand', financial: 'PAID', fulfillment: 'FULFILLED', paymentMethod: 'cashfree', cancelled: false, deliveredAt: iso(1) },
    ],
    abandoned: [], demos: [
      { id: 'd1', name: '#D12', customer: 'Riya D.', status: 'requested', date: 'Tomorrow', slot: '4–6 pm', bags: 'Tote · Rust, Clutch · Sand', email: 'riya@example.com', phone: '+91 97000 05590', createdAt: iso(1) },
    ],
    viewings: [], people: [], affiliates: [{ slug: 'priya', label: 'Priya Sharma', clicks: 610, orders: 14, revenue: 190000, currency: 'INR', conversionRate: 2.3 }],
    subscribers: [{ email: 'hello@example.com', createdAt: iso(2), source: 'footer', shopifyOk: true }],
    funnelDaily: {}, funnel: null,
  };
}
