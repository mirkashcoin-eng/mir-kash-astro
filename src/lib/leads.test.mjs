// Self-check for the identity + stage logic that decides who appears where in /admin.
// Run: node src/lib/leads.test.mjs
import assert from 'node:assert/strict';

// Mirrors personKey() in leads.ts — the person key every session and every Shopify
// record is matched on. If this drifts, people silently split into duplicate rows.
const personKey = (phone) => {
  const d = String(phone ?? '').replace(/[^0-9]/g, '');
  return d.length >= 10 ? d.slice(-10) : '';
};

// Every way the same Indian number reaches us must collapse to one person.
const same = ['7738784781', '+917738784781', '917738784781', '+91 77387 84781', '077387-84781'];
for (const v of same) assert.equal(personKey(v), '7738784781', `normalise ${v}`);

// Junk and short numbers must not create a person (would collide as one blank row).
for (const v of [null, undefined, '', 'not a phone', '12345', '+91']) {
  assert.equal(personKey(v), '', `reject ${JSON.stringify(v)}`);
}

// Mirrors stageOf() — furthest step the person's own data proves.
const stageOf = (v) => {
  if (v.addressAt || v.address1) return 'address';
  if (v.phoneAt || v.phone) return 'phone';
  if (v.cartAt) return 'cart';
  return 'visited';
};
assert.equal(stageOf({}), 'visited');
assert.equal(stageOf({ cartAt: 1 }), 'cart');
assert.equal(stageOf({ cartAt: 1, phone: '+919999999999' }), 'phone');
assert.equal(stageOf({ cartAt: 1, phone: 'x', address1: 'Flat 4' }), 'address');
// A legacy checkout_leads import has only a phone — it must land on 'phone', not 'visited'.
assert.equal(stageOf({ phone: '7738784781' }), 'phone');

// Anonymous people are keyed `anon:{sessionId}` and must never collide with a phone
// key — otherwise two different humans could share one row.
const ANON = 'anon:';
const anonKey = (sid) => ANON + sid;
assert.equal(personKey(anonKey('abc-123')), '', 'an anon key must not parse as a phone');
assert.notEqual(anonKey('7738784781'), personKey('7738784781'), 'anon and phone keys stay distinct');

// Stage must work for anonymous rows too — that is the whole point of showing them.
assert.equal(stageOf({ visitAt: 1 }), 'visited', 'browsed only');
assert.equal(stageOf({ visitAt: 1, cartAt: 2 }), 'cart', 'added a bag, no phone yet');

// Merge-on-identify: the anon record's history must survive into the phone identity.
const mergeAnon = (anon, person) => ({
  ...person,
  firstSeen: anon.firstSeen ?? person.firstSeen,   // anon started the journey
  cartAt: anon.cartAt ?? person.cartAt,
  items: [...new Set([...(person.items ?? []), ...(anon.items ?? [])])],
  cartAdds: (person.cartAdds ?? 0) + (anon.cartAdds ?? 0),
});
const merged = mergeAnon(
  { firstSeen: 100, cartAt: 150, items: ['Tote'], cartAdds: 1 },
  { firstSeen: 200, items: ['Clutch'], cartAdds: 1 },
);
assert.equal(merged.firstSeen, 100, 'earlier anon firstSeen wins');
assert.equal(merged.cartAt, 150, 'anon cart history carries over');
assert.deepEqual(merged.items.sort(), ['Clutch', 'Tote'], 'bags from both records survive');
assert.equal(merged.cartAdds, 2, 'cart-add counts sum, not overwrite');

// Mirrors the API overlay: Shopify (money) outranks anything the browser reported.
const overlay = (stage, { abandoned, ordered }) => (ordered ? 'ordered' : abandoned ? 'payment' : stage);
assert.equal(overlay('address', { abandoned: true, ordered: false }), 'payment');
assert.equal(overlay('address', { abandoned: true, ordered: true }), 'ordered', 'paid beats abandoned');
assert.equal(overlay('cart', { abandoned: false, ordered: false }), 'cart');

console.log('leads self-check: all assertions passed');
