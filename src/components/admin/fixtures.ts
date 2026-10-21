// SAMPLE DATA for design review. Only used behind the ?demo=1 flag, and the UI labels
// it "Sample data". None of these numbers describe the real shop.
import type {
  AcquisitionData, AudienceData, CheckoutData, InboxData, Metric, OverviewData, PeopleList,
  PeopleQuery, PersonDetail, PersonRow, ProductsData, RetentionData, Series, TrackingHealth,
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

export function demoInbox(): InboxData {
  const wa = { kind: 'whatsapp' as const, label: 'WhatsApp', href: 'https://wa.me/910000000000' };
  const done = { kind: 'done' as const, label: 'Done' };
  return {
    total: 11,
    groups: [
      {
        key: 'ready', title: 'Ready to buy',
        items: [
          { id: 'a1', title: 'Priya S. · Mumbai', detail: '₹18,400 cart · 3rd visit · gave phone yesterday', score: 92, personId: 'p1', actions: [wa, done] },
          { id: 'a2', title: 'Aanya K. · Pune', detail: '₹12,900 cart · viewed Tote 6 min · reached checkout', score: 86, personId: 'p2', actions: [wa, done] },
          { id: 'a3', title: 'Visitor from Instagram · Delhi', detail: '4 bags viewed · 2nd visit · no phone yet', score: 61, personId: 'p4', actions: [], note: 'No number to contact' },
        ],
      },
      {
        key: 'payment', title: 'Payment didn’t go through',
        items: [
          { id: 'b1', title: 'Neha R. · ₹9,800', detail: 'UPI declined 2 hours ago · cart still open', actions: [{ kind: 'link', label: 'Send retry link', href: 'https://wa.me/910000000000' }, done] },
          { id: 'b2', title: 'Isha M. · ₹14,200', detail: 'Card failed yesterday · tried again, failed', actions: [{ kind: 'link', label: 'Send retry link', href: 'https://wa.me/910000000000' }, done] },
        ],
      },
      {
        key: 'tah', title: 'Try at Home to confirm',
        items: [
          { id: 'c1', title: 'Riya D. · Tomorrow, 4–6 pm', detail: 'Bandra · 2 bags chosen', actions: [{ kind: 'link', label: 'Confirm', href: '#demos' }, { kind: 'link', label: 'Reschedule', href: '#demos' }] },
          { id: 'c2', title: 'Meera P. · Today, 11 am', detail: 'Worli · 1 bag · mark what happened', actions: [{ kind: 'done', label: 'Completed' }, { kind: 'done', label: 'No-show' }] },
        ],
      },
      {
        key: 'soldout', title: 'Wanted but sold out',
        items: [
          { id: 'd1', title: 'Tote · Rust', detail: '212 views in 30 days · 41 people looked longer than a minute', bar: 84, actions: [] },
          { id: 'd2', title: 'Satchel · Ink', detail: '96 views in 30 days · 12 looked longer than a minute', bar: 38, actions: [] },
        ],
      },
    ],
  };
}

const ROWS: PersonRow[] = [
  { id: 'p1', name: 'Priya S.', location: 'Mumbai', contact: '+91 98•••• 4821', stage: 'cart', visits: 3, returning: true, source: 'Instagram · reel-1', device: 'iPhone', timeOnSiteMin: 11, cartValue: 18400, score: 92, ordered: false },
  { id: 'p2', name: 'Aanya K.', location: 'Pune', contact: '+91 99•••• 1207', stage: 'payment', visits: 2, returning: true, source: 'Google · search', device: 'Android', timeOnSiteMin: 9, cartValue: 12900, score: 86, ordered: false },
  { id: 'p3', name: 'Neha R.', location: 'Delhi', contact: '+91 98•••• 7733', stage: 'payment', visits: 1, returning: false, source: 'Direct', device: 'Desktop', timeOnSiteMin: 6, cartValue: 9800, score: 74, ordered: false },
  { id: 'p4', name: 'Visitor', location: 'Delhi', contact: 'no contact yet', stage: 'viewed', visits: 2, returning: true, source: 'Instagram · paid', device: 'iPhone', timeOnSiteMin: 8, cartValue: null, score: 61, ordered: false },
  { id: 'p5', name: 'Riya D.', location: 'Mumbai', contact: '+91 97•••• 5590', stage: 'ordered', visits: 4, returning: true, source: 'Affiliate · priya', device: 'iPhone', timeOnSiteMin: 22, cartValue: 21000, score: null, ordered: true },
  { id: 'p6', name: 'Visitor', location: 'Bengaluru', contact: 'no contact yet', stage: 'viewed', visits: 1, returning: false, source: 'Google · organic', device: 'Android', timeOnSiteMin: 1, cartValue: null, score: 18, ordered: false },
];

export function demoPeople(pq: PeopleQuery): PeopleList {
  let rows = ROWS.slice();
  if (pq.stage === 'returning') rows = rows.filter((r) => r.returning);
  else if (pq.stage && pq.stage !== 'all') rows = rows.filter((r) => r.stage === pq.stage);
  if (pq.q) {
    const q = pq.q.toLowerCase();
    rows = rows.filter((r) => [r.name, r.location, r.contact, r.source, r.device].join(' ').toLowerCase().includes(q));
  }
  return { total: rows.length, returning: ROWS.filter((r) => r.returning).length, page: 1, pageSize: 50, rows };
}

export function demoPerson(id: string): PersonDetail | null {
  const row = ROWS.find((r) => r.id === id);
  if (!row) return null;
  return {
    row,
    summary: row.cartValue ? '₹' + row.cartValue.toLocaleString('en-IN') + ' cart · ' + row.visits + ' visits' : row.visits + ' visits',
    firstSeen: '9 Oct',
    firstCame: row.source,
    lastCame: 'Direct',
    deviceLine: row.device + ' · Safari',
    timeOnSite: (row.timeOnSiteMin ?? 0) + ' min total',
    sections: [],
    timeline: [
      { at: 'Today, 10:12', text: 'Added Tote · Rust to cart', sub: 'Visit 3 · Direct' },
      { at: 'Yesterday, 21:40', text: 'Entered phone number', sub: 'Visit 2 · reached checkout, left at payment' },
      { at: 'Yesterday, 21:31', text: 'Looked at Tote gallery for 3 min, opened materials', sub: 'Visit 2 · Google' },
      { at: '9 Oct, 19:05', text: 'First visit, viewed 2 bags', sub: 'Visit 1 · ' + row.source },
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
