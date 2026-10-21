// Self-check for the lead score and its one-line reason (Action inbox, People list).
// Run: node src/lib/leadscore.test.mjs   (Node 23.6+ imports the .ts directly)
import assert from 'node:assert/strict';
import {
  leadScore, leadReason, notALead, inrShort, ordinal, whenIst, scoreSql, cartInr,
  CART_BANDS, RECENCY_BANDS, VISIT_BANDS, ENGAGED_MIN_BANDS, PRODUCT_BANDS,
  PHONE_POINTS, BOOKING_POINTS, CHECKOUT_POINTS, HOT_THRESHOLD,
} from './leadscore.ts';

// 21 Oct 2026, 15:00 IST
const NOW = Date.parse('2026-10-21T09:30:00Z');
const ago = (h) => new Date(NOW - h * 3600e3).toISOString();

const blank = {
  cart_value: null, cart_currency: 'INR', last_seen: null, visits: 1, engaged_ms: 0, products_viewed: 0,
  phone_given: false, phone_at: null, booking_started: false, booking_flow: null, checkout_reached: false,
  last_cart_at: null, last_order_at: null, orders: 0, is_bot: false, is_test: false,
};
const lead = (o) => ({ ...blank, ...o });

// Every weight together is exactly 100, so the score reads as a percentage.
const top = (b) => b[0][1];
assert.equal(top(CART_BANDS) + top(RECENCY_BANDS) + PHONE_POINTS + top(VISIT_BANDS) + top(ENGAGED_MIN_BANDS)
  + BOOKING_POINTS + top(PRODUCT_BANDS) + CHECKOUT_POINTS, 100);
const maxed = lead({ cart_value: 40000, last_seen: ago(1), visits: 6, engaged_ms: 20 * 60e3, products_viewed: 8,
  phone_given: true, phone_at: ago(2), booking_started: true, checkout_reached: true, last_cart_at: ago(1) });
assert.equal(leadScore(maxed, NOW), 100);

// A one-page visit long ago scores nothing; anything that happened shows up.
assert.equal(leadScore(lead({}), NOW), 0);
assert.equal(leadScore(lead({ last_seen: ago(2) }), NOW), 20);       // here today
assert.equal(leadScore(lead({ last_seen: ago(50) }), NOW), 15);      // ≤ 3 days
assert.equal(leadScore(lead({ last_seen: ago(24 * 10) }), NOW), 5);  // ≤ 14 days

// The example from the brief: ₹18k cart, 3rd visit, gave phone yesterday.
const priya = lead({ cart_value: 18000, last_seen: ago(20), visits: 3, engaged_ms: 6 * 60e3, products_viewed: 3,
  phone_given: true, phone_at: ago(20), checkout_reached: true, last_cart_at: ago(21) });
// 24 cart + 20 today-ish (<24h) + 10 phone + 8 visits + 7 engaged + 4 bags + 6 checkout
assert.equal(leadScore(priya, NOW), 79);
assert.ok(leadScore(priya, NOW) >= HOT_THRESHOLD);
assert.equal(leadReason(priya, NOW), '₹18k cart · 3rd visit · gave phone yesterday');

// Bigger cart → higher score, everything else equal.
assert.ok(leadScore(lead({ ...priya, cart_value: 30000 }), NOW) > leadScore(priya, NOW));
// International cart is weighed in rupees for the band.
assert.equal(cartInr({ cart_value: 200, cart_currency: 'usd' }), 17000);
assert.equal(leadScore(lead({ cart_value: 200, cart_currency: 'USD' }), NOW), 24);

// Interest fades: same person, last seen 45 days ago → halved; 120 days → quartered.
const old45 = lead({ ...priya, last_seen: ago(24 * 45) });
assert.equal(leadScore(old45, NOW), Math.round((79 - 20) * 0.5));
assert.equal(leadScore(lead({ ...priya, last_seen: ago(24 * 120) }), NOW), Math.round((79 - 20) * 0.25));

// Not leads: bots, test numbers, and anyone who ordered after their last cart.
assert.equal(leadScore(lead({ ...priya, is_bot: true }), NOW), null);
assert.equal(leadScore(lead({ ...priya, is_test: true }), NOW), null);
assert.equal(leadReason(lead({ ...priya, is_test: true }), NOW), 'Test number');
const bought = lead({ ...priya, orders: 1, last_order_at: ago(10) });       // ordered after the cart
assert.equal(notALead(bought), 'Already ordered');
assert.equal(leadScore(bought, NOW), null);
assert.equal(leadScore(lead({ ...priya, orders: 1, last_cart_at: null, last_order_at: ago(500) }), NOW), null);
// …but a customer who came back and filled a NEW cart is a lead again.
assert.equal(leadScore(lead({ ...priya, orders: 1, last_order_at: ago(24 * 60) }), NOW), 79);

// Reasons in plain words.
assert.equal(leadReason(lead({ last_seen: ago(1) }), NOW), 'seen today');
assert.equal(leadReason(lead({ cart_value: 8500, visits: 2, checkout_reached: true, last_seen: ago(30) }), NOW),
  '₹8.5k cart · 2nd visit · reached checkout · seen yesterday');
assert.equal(leadReason(lead({ booking_started: true, booking_flow: 'try_at_home', phone_given: true, phone_at: ago(24 * 3),
  engaged_ms: 9 * 60e3, last_seen: ago(3) }), NOW), 'started Try at Home · gave phone 3 days ago · 9 min browsing');
assert.equal(leadReason(lead({ products_viewed: 5, last_seen: ago(24 * 9) }), NOW), 'viewed 5 bags · seen on 12 Oct');

// Formatting helpers.
assert.equal(inrShort(950), '₹950');
assert.equal(inrShort(8000), '₹8k');
assert.equal(inrShort(8460), '₹8.5k');
assert.equal(inrShort(18000), '₹18k');
assert.equal(inrShort(124000), '₹1.2L');
assert.deepEqual([1, 2, 3, 4, 11, 12, 13, 21, 22, 101].map(ordinal), ['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '101st']);
// IST calendar days: 00:30 IST today is "today" even though it's yesterday in UTC.
assert.equal(whenIst('2026-10-20T19:00:00Z', NOW), 'today');
assert.equal(whenIst('2026-10-20T18:00:00Z', NOW), 'yesterday');  // 23:30 IST on the 20th
assert.equal(whenIst(null, NOW), '');

// The SQL twin is built from the same weights (parity is checked against Postgres
// in db/tests/people.test.mjs).
const sql = scoreSql('p');
for (const s of ['p.cart_value', 'p.last_seen', 'p.phone_given', 'p.is_bot', 'p.is_test', 'p.last_order_at', 'WHEN p.visits >= 4 THEN 10']) {
  assert.ok(sql.includes(s), s);
}
assert.ok(!/;/.test(sql));

console.log('leadscore: all checks passed');
