// Self-check for acquisition + buyer metrics: source labelling, first-touch
// preservation, time-to-purchase, and repeat-buyer tallies.
// Run: node src/lib/acquisition.test.mjs
import assert from 'node:assert/strict';

// Mirrors sourceLabel() in leads.ts.
function sourceLabel(v) {
  const utm = v.utmSource || '';
  if (utm) {
    const campaign = v.utmCampaign || '';
    return campaign ? `${utm} · ${campaign}` : utm;
  }
  const ref = v.referrer || '';
  if (!ref) return null;
  try {
    const host = new URL(ref).hostname.replace(/^www\./, '');
    const known = {
      'instagram.com': 'Instagram', 'l.instagram.com': 'Instagram',
      'facebook.com': 'Facebook', 'm.facebook.com': 'Facebook', 'l.facebook.com': 'Facebook',
      'google.com': 'Google', 'google.co.in': 'Google',
      'pinterest.com': 'Pinterest', 'in.pinterest.com': 'Pinterest',
      'linkedin.com': 'LinkedIn', 'lnkd.in': 'LinkedIn',
      't.co': 'X/Twitter', 'youtube.com': 'YouTube',
    };
    return known[host] || host;
  } catch {
    return null;
  }
}

// A deliberate tag beats the referring domain — it's what we chose to measure.
assert.equal(sourceLabel({ utmSource: 'priya', utmCampaign: 'diwali' }), 'priya · diwali');
assert.equal(sourceLabel({ utmSource: 'newsletter' }), 'newsletter');
assert.equal(sourceLabel({ utmSource: 'priya', referrer: 'https://instagram.com/' }), 'priya', 'utm outranks referrer');
// Known networks read as names, and the mobile/link-shim hosts must fold into one.
assert.equal(sourceLabel({ referrer: 'https://www.instagram.com/p/abc' }), 'Instagram');
assert.equal(sourceLabel({ referrer: 'https://l.instagram.com/?u=x' }), 'Instagram', 'link shim is still Instagram');
assert.equal(sourceLabel({ referrer: 'https://m.facebook.com/x' }), 'Facebook');
// Unknown hosts fall back to a bare domain rather than a URL.
assert.equal(sourceLabel({ referrer: 'https://www.vogue.in/article/x' }), 'vogue.in');
// Nothing to say beats saying something wrong.
assert.equal(sourceLabel({}), null, 'direct traffic has no source');
assert.equal(sourceLabel({ referrer: 'not a url' }), null, 'malformed referrer degrades quietly');

// Mirrors daysBetween() in data.ts.
function daysBetween(from, to) {
  if (!from || !to) return null;
  const a = new Date(from).getTime();
  const b = new Date(to).getTime();
  if (!isFinite(a) || !isFinite(b) || b < a) return null;
  return Math.floor((b - a) / 864e5);
}
assert.equal(daysBetween('2026-03-01T10:00:00Z', '2026-03-01T20:00:00Z'), 0, 'same-day purchase is 0 days');
assert.equal(daysBetween('2026-03-01T00:00:00Z', '2026-03-08T00:00:00Z'), 7);
assert.equal(daysBetween(null, '2026-03-08T00:00:00Z'), null, 'no first-seen, no answer');
assert.equal(daysBetween('2026-03-01T00:00:00Z', null), null, 'never ordered, no answer');
// An order predating first-seen means the data is inconsistent (legacy import,
// clock skew) — report nothing rather than a negative number.
assert.equal(daysBetween('2026-03-08T00:00:00Z', '2026-03-01T00:00:00Z'), null, 'no negative durations');

// Mirrors the orderCount / lifetimeValue / firstOrder rollup in data.ts.
function rollup(orders) {
  const live = orders.filter((o) => !o.cancelled);
  const firstOrder = live.length
    ? live.reduce((old, x) => (new Date(x.createdAt) < new Date(old.createdAt) ? x : old))
    : null;
  return {
    orderCount: live.length,
    lifetimeValue: live.reduce((s, x) => s + Number(x.total?.amount || 0), 0),
    firstOrderAt: firstOrder?.createdAt ?? null,
  };
}

// Orders arrive newest-first, so the reduce must still find the OLDEST one —
// otherwise time-to-purchase would measure the latest order, not the first.
const r = rollup([
  { createdAt: '2026-03-20T00:00:00Z', total: { amount: '5000' }, cancelled: false },
  { createdAt: '2026-03-05T00:00:00Z', total: { amount: '8000' }, cancelled: false },
  { createdAt: '2026-03-25T00:00:00Z', total: { amount: '99999' }, cancelled: true },
]);
assert.equal(r.orderCount, 2, 'cancelled orders are not purchases');
assert.equal(r.lifetimeValue, 13000, 'cancelled value excluded from lifetime');
assert.equal(r.firstOrderAt, '2026-03-05T00:00:00Z', 'oldest order dates the first purchase');
assert.equal(daysBetween('2026-03-01T00:00:00Z', r.firstOrderAt), 4);
// Repeat buyer is strictly more than one live order.
assert.ok(r.orderCount > 1, 'two live orders is a repeat buyer');
assert.equal(rollup([{ createdAt: '2026-03-05T00:00:00Z', total: { amount: '1' }, cancelled: false }]).orderCount, 1);
assert.equal(rollup([]).firstOrderAt, null, 'no orders, no first order');

// Viewed-but-not-bagged: the set difference the drawer shows.
function browsedOnly(viewed, items) {
  const bagged = new Set(items);
  return viewed.filter((t) => !bagged.has(t));
}
assert.deepEqual(browsedOnly(['Tote', 'Clutch', 'Belt'], ['Clutch']), ['Tote', 'Belt']);
assert.deepEqual(browsedOnly(['Tote'], ['Tote']), [], 'everything bagged leaves nothing to nudge');
assert.deepEqual(browsedOnly([], ['Tote']), [], 'no views, nothing to show');

console.log('acquisition self-check: all assertions passed');
