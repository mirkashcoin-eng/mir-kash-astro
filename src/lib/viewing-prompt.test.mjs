// Self-check for the Try at Home / Private Viewing prompt rules.
// Run: node src/lib/viewing-prompt.test.mjs
import assert from 'node:assert/strict';
import {
  PROMPT_KEY, DISMISS_QUIET_MS, CLICK_QUIET_MS, PRODUCT_DWELL_MS, EXIT_INTENT_MIN_MS,
  readState, mark, canShow, shownThisSession, markShownThisSession, productReady,
} from './viewing-prompt.ts';

function fakeStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
  };
}
const throwingStorage = {
  getItem() { throw new Error('storage disabled'); },
  setItem() { throw new Error('storage disabled'); },
};

const NOW = 1_800_000_000_000;

// A fresh visitor may see it, on either kind of page.
assert.equal(canShow(readState(fakeStorage(), 'home'), false, NOW), true);
assert.equal(canShow(readState(fakeStorage(), 'product'), false, NOW), true);

// Once per visit on each kind of page: seeing it on the homepage doesn't use up the product page.
{
  const s = fakeStorage();
  assert.equal(shownThisSession(s, 'home'), false);
  markShownThisSession(s, 'home');
  assert.equal(shownThisSession(s, 'home'), true);
  assert.equal(shownThisSession(s, 'product'), false);
  assert.equal(canShow({}, true, NOW), false);
}

// Dismissed → quiet for a week on that page kind only, then allowed again.
{
  const s = fakeStorage();
  mark(s, 'dismissedAt', NOW, 'home');
  assert.equal(canShow(readState(s, 'home'), false, NOW + DISMISS_QUIET_MS - 1), false);
  assert.equal(canShow(readState(s, 'home'), false, NOW + DISMISS_QUIET_MS), true);
  assert.equal(canShow(readState(s, 'product'), false, NOW), true, 'homepage dismissal does not silence product pages');
}

// Link followed → quiet for a month on that page kind only.
{
  const s = fakeStorage();
  mark(s, 'clickedAt', NOW, 'product');
  assert.equal(canShow(readState(s, 'product'), false, NOW + CLICK_QUIET_MS - 1), false);
  assert.equal(canShow(readState(s, 'product'), false, NOW + CLICK_QUIET_MS), true);
  assert.equal(canShow(readState(s, 'home'), false, NOW), true);
}

// Homepage and Shop All share one allowance and one set of quiet periods; product pages are separate.
{
  const ss = fakeStorage();
  markShownThisSession(ss, 'home');
  assert.equal(shownThisSession(ss, 'shop'), true, 'seen on the homepage → not again on Shop All');
  assert.equal(shownThisSession(ss, 'product'), false);
  const s = fakeStorage();
  mark(s, 'dismissedAt', NOW, 'shop');
  assert.equal(canShow(readState(s, 'home'), false, NOW + 1), false, 'closed on Shop All → quiet on the homepage too');
  assert.equal(canShow(readState(s, 'product'), false, NOW + 1), true);
}

// Booked → never again anywhere, and marks accumulate rather than overwrite.
{
  const s = fakeStorage();
  mark(s, 'dismissedAt', NOW, 'home');
  mark(s, 'bookedAt', NOW);
  assert.deepEqual(readState(s, 'home'), { dismissedAt: NOW, clickedAt: undefined, bookedAt: NOW });
  assert.equal(canShow(readState(s, 'home'), false, NOW + 10 * CLICK_QUIET_MS), false);
  assert.equal(canShow(readState(s, 'product'), false, NOW + 10 * CLICK_QUIET_MS), false);
}

// The booking pages' inline script writes bookedAt into an existing v1 object; that must be honoured.
{
  const s = fakeStorage();
  mark(s, 'dismissedAt', NOW, 'home');
  const p = JSON.parse(s.getItem(PROMPT_KEY));
  p.bookedAt = NOW; p.v = 1;
  s.setItem(PROMPT_KEY, JSON.stringify(p));
  assert.equal(canShow(readState(s, 'product'), false, NOW), false);
  assert.equal(readState(s, 'home').dismissedAt, NOW);
}

// Old or corrupt payloads are ignored, never thrown.
{
  const s = fakeStorage();
  s.setItem(PROMPT_KEY, '{not json');
  assert.deepEqual(readState(s, 'home'), { dismissedAt: undefined, clickedAt: undefined, bookedAt: undefined });
  s.setItem(PROMPT_KEY, JSON.stringify({ v: 0, bookedAt: NOW }));
  assert.equal(readState(s, 'home').bookedAt, undefined);
}

// Storage that throws (Safari private mode, in-app webviews) degrades silently.
assert.equal(canShow(readState(throwingStorage, 'home'), false, NOW), true);
assert.doesNotThrow(() => mark(throwingStorage, 'dismissedAt', NOW, 'home'));
assert.equal(shownThisSession(throwingStorage, 'home'), false);
assert.doesNotThrow(() => markShownThisSession(throwingStorage, 'home'));
assert.equal(canShow(readState(undefined, 'product'), false, NOW), true);

// Product trigger: time AND scroll, or desktop exit intent after a short read; never while buying.
const base = { dwellMs: 0, pastBuyArea: false, exitIntent: false, atBottom: false, buying: false };
assert.equal(productReady({ ...base, dwellMs: PRODUCT_DWELL_MS }), false, 'time alone is not enough');
assert.equal(productReady({ ...base, pastBuyArea: true, dwellMs: PRODUCT_DWELL_MS - 1 }), false);
assert.equal(productReady({ ...base, pastBuyArea: true, dwellMs: PRODUCT_DWELL_MS }), true);
assert.equal(productReady({ ...base, exitIntent: true, dwellMs: EXIT_INTENT_MIN_MS - 1 }), false, 'no prompt on a bounce');
assert.equal(productReady({ ...base, exitIntent: true, dwellMs: EXIT_INTENT_MIN_MS }), true);
assert.equal(productReady({ dwellMs: 1e9, pastBuyArea: true, exitIntent: true, atBottom: true, buying: true }), false);
assert.equal(productReady({ ...base, atBottom: true }), true, 'reaching the bottom is enough on its own');

console.log('viewing-prompt: all checks passed');
