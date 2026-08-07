// Self-check for the daily funnel grid: IST day bucketing, the mutually-exclusive
// product-count buckets, and first-reach counting.
// Run: node src/components/admin-daily.test.mjs
import assert from 'node:assert/strict';

// Mirrors istDay() in AdminDashboard.astro.
function istDay(ts) {
  if (!ts) return '';
  const t = new Date(ts).getTime();
  if (!isFinite(t) || !t) return '';
  return new Date(t).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
}

// A day is the STORE's day. 19:00 UTC is already past midnight in Mumbai (+5:30),
// so it must bucket to the next calendar day — the whole point of using IST.
assert.equal(istDay('2026-03-14T19:00:00Z'), '2026-03-15', 'late-UTC evening is next day in IST');
assert.equal(istDay('2026-03-14T18:29:00Z'), '2026-03-14', 'just before the IST rollover');
assert.equal(istDay('2026-03-14T18:31:00Z'), '2026-03-15', 'just after the IST rollover');
assert.equal(istDay(null), '', 'missing timestamps bucket nowhere');
assert.equal(istDay('not-a-date'), '', 'garbage buckets nowhere');

// Mirrors daysInMonth().
const daysInMonth = (m) => new Date(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0).getDate();
assert.equal(daysInMonth('2026-02'), 28);
assert.equal(daysInMonth('2024-02'), 29, 'leap year');
assert.equal(daysInMonth('2026-01'), 31);
assert.equal(daysInMonth('2026-04'), 30);

// Mirrors DAILY_ROWS.
const DAILY_ROWS = [
  { key: 'visits', day: (p) => istDay(p.firstSeen) },
  { key: 'p1', day: (p) => (p.viewed.length === 1 ? istDay(p.viewedAt || p.firstSeen) : '') },
  { key: 'p2', day: (p) => (p.viewed.length === 2 ? istDay(p.viewedAt || p.firstSeen) : '') },
  { key: 'p3', day: (p) => (p.viewed.length > 2 ? istDay(p.viewedAt || p.firstSeen) : '') },
  { key: 'cart', day: (p) => istDay(p.cartAt) },
  { key: 'phone', day: (p) => istDay(p.phoneAt) },
  { key: 'address', day: (p) => istDay(p.addressAt) },
];

function dailyCounts(month, people, abandoned, orders) {
  const grid = {};
  for (const r of DAILY_ROWS) grid[r.key] = {};
  grid.checkout = {};
  grid.ordered = {};
  const bump = (key, day) => {
    if (!day || day.slice(0, 7) !== month) return;
    grid[key][day] = (grid[key][day] || 0) + 1;
  };
  for (const p of people) for (const r of DAILY_ROWS) bump(r.key, r.day(p));
  for (const a of abandoned) bump('checkout', istDay(a.createdAt));
  for (const o of orders) {
    if (o.cancelled) continue;
    bump('checkout', istDay(o.createdAt));
    bump('ordered', istDay(o.createdAt));
  }
  return grid;
}

const D = '2026-03-10T06:00:00Z'; // mid-morning IST, unambiguous
const day = '2026-03-10';
const people = [
  { firstSeen: D, viewed: [], cartAt: null, phoneAt: null, addressAt: null },
  { firstSeen: D, viewed: ['a'], viewedAt: D, cartAt: null, phoneAt: null, addressAt: null },
  { firstSeen: D, viewed: ['a', 'b'], viewedAt: D, cartAt: null, phoneAt: null, addressAt: null },
  { firstSeen: D, viewed: ['a', 'b', 'c'], viewedAt: D, cartAt: D, phoneAt: D, addressAt: null },
  { firstSeen: D, viewed: ['a', 'b', 'c', 'd'], viewedAt: D, cartAt: D, phoneAt: D, addressAt: D },
  // Someone from a different month must not leak into this grid.
  { firstSeen: '2026-02-10T06:00:00Z', viewed: ['a'], viewedAt: '2026-02-10T06:00:00Z', cartAt: null, phoneAt: null, addressAt: null },
];
const g = dailyCounts('2026-03', people, [{ createdAt: D }], [
  { createdAt: D, cancelled: false },
  { createdAt: D, cancelled: true }, // cancelled: not a sale, not a checkout
]);

assert.equal(g.visits[day], 5, 'only this month’s visitors');
assert.equal(g.p1[day], 1);
assert.equal(g.p2[day], 1);
assert.equal(g.p3[day], 2, '3 and 4 products both land in 2+');
// The three product buckets must partition the viewers — never double-count.
assert.equal(g.p1[day] + g.p2[day] + g.p3[day], 4, 'the one zero-view person is in no bucket');
assert.equal(g.cart[day], 2);
assert.equal(g.phone[day], 2);
assert.equal(g.address[day], 1);
// An order implies a checkout attempt, so checkout = abandoned + live orders.
assert.equal(g.checkout[day], 2, 'one abandoned + one live order');
assert.equal(g.ordered[day], 1, 'cancelled orders are not sales');
// February must be untouched by a March grid.
assert.equal(g.visits['2026-02-10'], undefined, 'other months stay out');

// Funnel monotonicity: each step should be <= the one above it on a given day.
const steps = [g.visits[day], g.cart[day], g.phone[day], g.address[day], g.ordered[day]];
for (let i = 1; i < steps.length; i++) {
  assert.ok(steps[i] <= steps[i - 1], `step ${i} (${steps[i]}) must not exceed step ${i - 1} (${steps[i - 1]})`);
}

// Nobody is counted twice in one row: a person reaching a step is counted on the
// single day that step's timestamp names, however many sessions they had.
const repeat = [{ firstSeen: D, viewed: ['a'], viewedAt: D, cartAt: D, phoneAt: D, addressAt: D }];
const g2 = dailyCounts('2026-03', repeat, [], []);
assert.equal(g2.visits[day], 1);
assert.equal(g2.cart[day], 1);

console.log('admin-daily self-check: all assertions passed');
