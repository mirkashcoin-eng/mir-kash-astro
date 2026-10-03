// Self-check for the cart "Before you go" panel rules.
// Run: node src/lib/cart-exit.test.mjs
import assert from 'node:assert/strict';
import {
  CX_KEY, CX_QUIET_MS, MAX_BAGS,
  readCx, markCx, canShowCx, shownCxThisVisit, markCxShown, checkoutStartedThisVisit, markCheckoutStarted, parseBags,
} from './cart-exit.ts';

function fakeStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) };
}
const throwingStorage = {
  getItem() { throw new Error('storage disabled'); },
  setItem() { throw new Error('storage disabled'); },
};
const NOW = 1_800_000_000_000;

// Fresh visitor may see it.
assert.equal(canShowCx(readCx(fakeStorage()), false, false, NOW), true);

// Once per visit, and never after going to checkout this visit.
{
  const s = fakeStorage();
  markCxShown(s);
  assert.equal(shownCxThisVisit(s), true);
  assert.equal(canShowCx({}, true, false, NOW), false);
  const t = fakeStorage();
  markCheckoutStarted(t);
  assert.equal(checkoutStartedThisVisit(t), true);
  assert.equal(canShowCx({}, false, true, NOW), false);
}

// Answered or closed → quiet for two weeks, then allowed again.
for (const field of ['answeredAt', 'dismissedAt']) {
  const s = fakeStorage();
  markCx(s, field, NOW);
  assert.equal(canShowCx(readCx(s), false, false, NOW + CX_QUIET_MS - 1), false, field);
  assert.equal(canShowCx(readCx(s), false, false, NOW + CX_QUIET_MS), true, field);
}

// Marks accumulate; old or corrupt payloads are ignored.
{
  const s = fakeStorage();
  markCx(s, 'dismissedAt', NOW);
  markCx(s, 'answeredAt', NOW + 5);
  assert.deepEqual(readCx(s), { answeredAt: NOW + 5, dismissedAt: NOW });
  s.setItem(CX_KEY, '{nope');
  assert.deepEqual(readCx(s), {});
  s.setItem(CX_KEY, JSON.stringify({ v: 0, answeredAt: NOW }));
  assert.deepEqual(readCx(s), {});
}

// Blocked storage degrades silently.
assert.deepEqual(readCx(throwingStorage), {});
assert.doesNotThrow(() => markCx(throwingStorage, 'answeredAt', NOW));
assert.equal(shownCxThisVisit(throwingStorage), false);
assert.doesNotThrow(() => markCxShown(throwingStorage));
assert.equal(checkoutStartedThisVisit(undefined), false);

// parseBags: clean, de-duplicated, capped, legacy ?bag= included, junk dropped.
assert.deepEqual(parseBags('gigi-mini-bag, Tory-Structured-Bag ,gigi-mini-bag'), ['gigi-mini-bag', 'tory-structured-bag']);
assert.deepEqual(parseBags(null, 'kelly-crystal-clutch'), ['kelly-crystal-clutch']);
assert.deepEqual(parseBags('a,b', 'b'), ['a', 'b']);
assert.deepEqual(parseBags('"><script>,../x,ok-bag'), ['ok-bag']);
assert.equal(parseBags('a,b,c,d,e,f,g,h').length, MAX_BAGS);
assert.deepEqual(parseBags('', ''), []);

console.log('cart-exit: all checks passed');
