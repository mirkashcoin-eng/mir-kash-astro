// SAMPLE DATA for design review. Only used behind the ?demo=1 flag, and the UI labels
// it "Sample data". None of these numbers describe the real shop.
import type {
  AcquisitionData, AudienceData, CheckoutData, Metric, OverviewData,
  PeopleQuery, ProductsData, RetentionData, Series, TrackingHealth,
} from './types';
import { addDays } from './format';

const M = (
  key: string, label: string, unit: Metric['unit'], value: number, prev: number | null, definition: string,
  extra: Partial<Metric> = {},
): Metric => ({ key, label, unit, value, prev, definition, smallSample: false, ...extra });

function series(label: string, unit: Series['unit'], from: string, to: string, base: number, amp: number, seed: number): Series {
  const days: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) days.push(d);
  const n = days.length;
  const f = (i: number, s: number) =>
    Math.max(0, base * (0.7 + 0.5 * (i / Math.max(n - 1, 1))) + amp * Math.sin((i + s) * 0.9) + amp * 0.5 * Math.cos((i + s) * 2.3));
  return {
    label, unit,
    points: days.map((day, i) => ({ day, value: Math.round(f(i, seed)), prev: Math.round(f(i, seed + 3) * 0.88) })),
  };
}

export function demoOverview(from: string, to: string): OverviewData {
  const people = (q: Partial<PeopleQuery>): PeopleQuery => q;
  return {
    metrics: [
      M('visitors', 'Visitors', 'count', 12840, 11464, 'People seen at least once in the range, excluding crawlers and test numbers.', { drill: people({ stage: 'all' }) }),
      M('returning', 'Returning', 'pct', 31, 28, 'Share of visitors who had visited before the start of the range.', { num: 3980, den: 12840, drill: people({ stage: 'returning' }) }),
      M('cartRate', 'Added to cart', 'pct', 6.4, 6.9, 'Share of visitors who put at least one bag in the cart.', { num: 822, den: 12840, drill: people({ stage: 'cart' }) }),
      M('orders', 'Orders', 'count', 164, 150, 'Paid or confirmed Shopify orders placed in the range, excluding cancelled and test orders.', { note: '1.3% of visitors. Goal 1.5%', goal: 1.5, drill: people({ stage: 'ordered' }) }),
      M('revenue', 'Revenue', 'inr', 2140000, 1877000, 'Sum of order totals in the range, excluding cancelled orders.', { note: 'Median order ₹11,900.' }),
    ],
    trend: [
      series('Revenue', 'inr', from, to, 62000, 14000, 1),
      series('Orders', 'count', from, to, 5, 2, 2),
      series('Visitors', 'count', from, to, 400, 90, 3),
    ],
    funnel: {
      steps: [
        { key: 'visited', label: 'Visited', count: 12840, ofPrev: null },
        { key: 'viewed', label: 'Viewed a bag', count: 8120, ofPrev: 63 },
        { key: 'cart', label: 'Added to cart', count: 822, ofPrev: 10, drill: { stage: 'cart' } },
        { key: 'phone', label: 'Gave phone', count: 410, ofPrev: 50, drill: { stage: 'phone' } },
        { key: 'payment', label: 'Reached payment', count: 231, ofPrev: 56, drill: { stage: 'payment' } },
        { key: 'ordered', label: 'Ordered', count: 164, ofPrev: 71, drill: { stage: 'ordered' } },
      ],
      leak: 'Biggest leak: cart → phone. Fewer than half leave a number.',
    },
    channels: demoChannels(),
  };
}

function demoChannels(): AcquisitionData['channels'] {
  return [
    { source: 'Instagram · paid', visitors: 4210, orders: 61, revenue: 790000, costPerSale: 620 },
    { source: 'Google · search', visitors: 3050, orders: 47, revenue: 580000, costPerSale: 410 },
    { source: 'Direct', visitors: 2380, orders: 33, revenue: 410000, costPerSale: null },
    { source: 'Affiliate · priya', visitors: 610, orders: 14, revenue: 190000, costPerSale: null, costNote: '₹300 commission' },
    { source: 'Instagram · organic', visitors: 1430, orders: 9, revenue: 170000, costPerSale: null },
  ];
}

export function demoAcquisition(): AcquisitionData {
  return {
    channels: demoChannels(),
    campaigns: [
      { campaign: 'reel-1', source: 'Instagram · paid', visitors: 2100, carts: 160, orders: 31, revenue: 402000, spend: 19200, roas: 20.9 },
      { campaign: 'wedding-edit', source: 'Instagram · paid', visitors: 2110, carts: 141, orders: 30, revenue: 388000, spend: 18700, roas: 20.7 },
      { campaign: 'brand-search', source: 'Google · search', visitors: 1800, carts: 150, orders: 33, revenue: 410000, spend: 13500, roas: 30.4 },
      { campaign: 'generic-bags', source: 'Google · search', visitors: 1250, carts: 70, orders: 14, revenue: 170000, spend: 5900, roas: 28.8 },
    ],
    landingPages: [
      { page: '/', visitors: 5200, orders: 58 },
      { page: '/products/tote', visitors: 2900, orders: 49 },
      { page: '/shop', visitors: 2100, orders: 31 },
      { page: '/try-at-home', visitors: 900, orders: 12 },
    ],
  };
}

export function demoProducts(): ProductsData {
  return {
    rows: [
      { title: 'Tote · Rust', views: 2120, viewers: 1450, carts: 160, orders: 38, medianViewSeconds: 74, soldOut: true, longLooks: 41 },
      { title: 'Tote · Ink', views: 1980, viewers: 1380, carts: 171, orders: 44, medianViewSeconds: 68 },
      { title: 'Satchel · Ink', views: 960, viewers: 700, carts: 33, orders: 6, medianViewSeconds: 52, soldOut: true, longLooks: 12 },
      { title: 'Clutch · Sand', views: 870, viewers: 640, carts: 71, orders: 21, medianViewSeconds: 49 },
      { title: 'Crossbody · Cocoa', views: 640, viewers: 480, carts: 20, orders: 3, medianViewSeconds: 83 },
    ],
    soldOutDemand: [
      { title: 'Tote · Rust', views: 212, longLooks: 41 },
      { title: 'Satchel · Ink', views: 96, longLooks: 12 },
    ],
    zeroResultSearches: [{ term: 'laptop sleeve', count: 18 }, { term: 'backpack', count: 11 }, { term: 'belt', count: 7 }],
  };
}

export function demoCheckout(): CheckoutData {
  return {
    metrics: [
      M('checkoutStart', 'Reached checkout', 'count', 392, 360, 'People who opened checkout in the range.'),
      M('phoneRate', 'Gave phone', 'pct', 50, 47, 'Share of people with a cart who entered a phone number.', { num: 410, den: 822, drill: { stage: 'phone' } }),
      M('paymentFail', 'Payment failures', 'pct', 11, 14, 'Share of payment attempts that failed.', { num: 29, den: 260, lowerIsBetter: true, drill: { stage: 'payment' } }),
      M('checkoutConv', 'Checkout to order', 'pct', 71, 66, 'Share of people who reached payment and then ordered.', { num: 164, den: 231, drill: { stage: 'ordered' } }),
    ],
    funnel: demoOverview('2026-09-22', '2026-10-21').funnel,
    failures: [{ reason: 'UPI declined', count: 14 }, { reason: 'Card failed', count: 9 }, { reason: 'OTP not entered', count: 6 }],
    paymentMix: [{ label: 'UPI', count: 98 }, { label: 'Card', count: 52 }, { label: 'Cash on delivery', count: 14 }],
  };
}

export function demoAudience(): AudienceData {
  return {
    newReturning: { new: { visitors: 8860, orders: 98 }, returning: { visitors: 3980, orders: 66 } },
    device: [
      { label: 'Mobile', visitors: 9500, orders: 86 },
      { label: 'Desktop', visitors: 2820, orders: 68 },
      { label: 'Tablet', visitors: 520, orders: 10 },
    ],
    cities: [
      { city: 'Mumbai', visitors: 2910, orders: 61 },
      { city: 'Delhi', visitors: 1980, orders: 32 },
      { city: 'Bengaluru', visitors: 1640, orders: 24 },
      { city: 'Pune', visitors: 890, orders: 13 },
      { city: 'Hyderabad', visitors: 720, orders: 9 },
    ],
    browsers: [
      { label: 'iPhone Safari', share: 41 }, { label: 'Android Chrome', share: 33 },
      { label: 'Desktop Chrome', share: 16 }, { label: 'Other', share: 10 },
    ],
    gift: M('gift', 'Likely gift orders', 'pct', 22, null, 'Orders shipped to a different name or city than the buyer. Worked out from the order; customers are never asked.', { num: 36, den: 164 }),
    ga: {
      available: true,
      age: [
        { label: '18–24', share: 9 }, { label: '25–34', share: 38 }, { label: '35–44', share: 29 },
        { label: '45–54', share: 16 }, { label: '55+', share: 8 },
      ],
      gender: [{ label: 'Women', share: 71 }, { label: 'Men', share: 27 }, { label: 'Unknown', share: 2 }],
      interests: ['Fashion & accessories', 'Weddings', 'Luxury shopping', 'Travel', 'Home décor', 'Sustainable living'],
    },
  };
}

export function demoRetention(): RetentionData {
  const rows: { cohort: string; size: number; weeks: (number | null)[] }[] = [];
  const sizes = [1180, 1240, 1105, 1320, 1290, 1410, 1360, 1520];
  const starts = ['24 Aug', '31 Aug', '7 Sep', '14 Sep', '21 Sep', '28 Sep', '5 Oct', '12 Oct'];
  sizes.forEach((size, i) => {
    const elapsed = sizes.length - i;
    const weeks: (number | null)[] = [];
    for (let w = 0; w < 8; w++) weeks.push(w >= elapsed ? null : w === 0 ? 100 : Math.max(2, Math.round(26 / (w + 0.6) + (i % 3))));
    rows.push({ cohort: 'Week of ' + starts[i], size, weeks });
  });
  return {
    metrics: [
      M('repeatRate', 'Repeat buyers', 'pct', 14, 12, 'Share of buyers with a second order.', { num: 23, den: 164 }),
      M('daysToBuy', 'Median days to first order', 'days', 6, 7, 'Median days from first visit to first order.', { lowerIsBetter: true }),
      M('visitsToBuy', 'Median visits to first order', 'count', 2, 2, 'Median number of visits before the first order.'),
    ],
    cohorts: rows,
  };
}

export function demoHealth(): TrackingHealth {
  return {
    status: 'healthy',
    label: 'Tracking healthy · orders match Shopify',
    checks: [
      { label: 'Orders match Shopify', ok: true, detail: '164 of 164 orders in the last 30 days.' },
      { label: 'Events arriving', ok: true, detail: 'Last event 2 minutes ago.' },
      { label: 'Google Analytics gap', ok: true, detail: 'Sessions within the expected range.' },
    ],
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
