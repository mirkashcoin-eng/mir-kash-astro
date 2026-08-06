// Self-check for affiliate attribution: the slug rule, the open-redirect guard, and
// the revenue aggregation. Run: node src/lib/clicks.test.mjs
import assert from 'node:assert/strict';

// ── Slug rule (mirrors SLUG_RE in clicks.ts) ─────────────────────────────────
const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;
for (const ok of ['priya', 'creator123', 'a-b-c', 'x1y']) {
  assert.ok(SLUG_RE.test(ok), `should accept ${ok}`);
}
// These would break the URL, escape the path, or collide with routing.
for (const bad of ['', 'ab', 'Priya', 'a_b', 'a b', '-lead', 'trail-', '../etc', 'a/b', 'a?b']) {
  assert.ok(!SLUG_RE.test(bad), `should reject ${JSON.stringify(bad)}`);
}

// ── Redirect target (mirrors safePath in /api/go/[affiliate].ts) ─────────────
const safePath = (raw) => (!raw || !raw.startsWith('/') || raw.startsWith('//') ? '/' : raw);
assert.equal(safePath('/products/tote'), '/products/tote');
assert.equal(safePath(null), '/');
// An affiliate link must never bounce a visitor off-site.
assert.equal(safePath('//evil.com'), '/', 'protocol-relative URL is not a local path');
assert.equal(safePath('https://evil.com'), '/', 'absolute URL is not a local path');

// ── Summary aggregation (mirrors getAffiliateSummary in clicks.ts) ───────────
function summarise(affiliates, orders, bySlug, counts) {
  const live = orders.filter((o) => !o.cancelled && o.clickId);
  const sales = new Map();
  for (const o of live) {
    const slug = bySlug.get(o.clickId);
    if (!slug) continue;
    const acc = sales.get(slug) ?? { orders: 0, revenue: 0 };
    acc.orders += 1;
    acc.revenue += Number(o.total?.amount || 0);
    sales.set(slug, acc);
  }
  return affiliates
    .map((a) => {
      const s = sales.get(a.slug);
      const clicks = counts.get(a.slug) || 0;
      const ordered = s?.orders ?? 0;
      return { slug: a.slug, clicks, orders: ordered, revenue: s?.revenue ?? 0,
        conversionRate: clicks ? (ordered / clicks) * 100 : 0 };
    })
    .sort((a, b) => b.revenue - a.revenue || b.clicks - a.clicks);
}

const affiliates = [{ slug: 'priya' }, { slug: 'raj' }, { slug: 'newbie' }];
const bySlug = new Map([['c1', 'priya'], ['c2', 'priya'], ['c3', 'raj']]);
const counts = new Map([['priya', 4], ['raj', 2], ['newbie', 0]]);
const orders = [
  { clickId: 'c1', cancelled: false, total: { amount: '15399' } },
  { clickId: 'c2', cancelled: false, total: { amount: '4999' } },
  { clickId: 'c3', cancelled: false, total: { amount: '8000' } },
  { clickId: 'c1', cancelled: true, total: { amount: '99999' } }, // refunded/cancelled
  { clickId: 'unknown', cancelled: false, total: { amount: '5000' } }, // click we didn't mint
  { clickId: null, cancelled: false, total: { amount: '7000' } },     // organic sale
];
const rows = summarise(affiliates, orders, bySlug, counts);
const by = Object.fromEntries(rows.map((r) => [r.slug, r]));

assert.equal(by.priya.orders, 2, 'two attributed orders');
assert.equal(by.priya.revenue, 20398, 'revenue sums both orders');
assert.equal(by.raj.revenue, 8000);
assert.equal(by.priya.conversionRate, 50, '2 orders / 4 clicks');

// A cancelled order must never be paid commission on.
assert.ok(by.priya.revenue < 99999, 'cancelled order excluded from revenue');
// Organic and forged/unknown click ids must not inflate anyone.
const attributed = rows.reduce((s, r) => s + r.revenue, 0);
assert.equal(attributed, 28398, 'unattributed sales stay unattributed');
// An affiliate with no clicks yet reports 0%, not NaN or a divide-by-zero.
assert.equal(by.newbie.conversionRate, 0);
assert.equal(by.newbie.revenue, 0);
// Highest earner sorts first.
assert.equal(rows[0].slug, 'priya');

console.log('affiliate self-check: all assertions passed');
