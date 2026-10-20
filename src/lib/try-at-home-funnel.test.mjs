// Self-check for the Try at Home step-count rules.
// Run: node src/lib/try-at-home-funnel.test.mjs
import assert from 'node:assert/strict';

// Mirrors src/lib/try-at-home-funnel.ts (kept inline, not imported, so this runs on
// plain Node without a TypeScript loader).
function isAdVisit(search) {
  const q = new URLSearchParams(search);
  return q.has('fbclid') || /^(fb|ig|facebook|instagram|meta)/i.test(q.get('utm_source') ?? '');
}
function freshRecord(prev, day, adNow) {
  const same = prev && prev.day === day && Array.isArray(prev.sent);
  return { day, ad: Boolean(adNow || (same && prev.ad)), sent: same ? prev.sent.filter((s) => typeof s === 'string') : [] };
}
function claimStep(rec, step) {
  if (rec.sent.includes(step)) return false;
  rec.sent.push(step);
  return true;
}
// Mirrors TRY_AT_HOME_EVENTS in analytics.ts: the names the server accepts.
const TRY_AT_HOME_EVENTS = ['th_view', 'th_datetime', 'th_details', 'th_phone', 'th_submit', 'th_booked'];

// ── Ad visits ──
assert.equal(isAdVisit('?bag=gigi-mini-bag&color=Olive+Green&fbclid=IwAR123'), true, 'a Meta click carries fbclid');
assert.equal(isAdVisit('?utm_source=facebook&utm_medium=paid'), true);
assert.equal(isAdVisit('?utm_source=ig'), true);
assert.equal(isAdVisit('?utm_source=Instagram'), true);
assert.equal(isAdVisit('?bag=gigi-mini-bag&color=Olive+Green'), false, 'the bag link alone is not an ad');
assert.equal(isAdVisit('?utm_source=newsletter'), false);
assert.equal(isAdVisit(''), false);

// ── Once per browser per day ──
let rec = freshRecord(null, '2026-10-20', false);
assert.deepEqual(rec, { day: '2026-10-20', ad: false, sent: [] });
assert.equal(claimStep(rec, 'th_view'), true, 'first view of the day is sent');
assert.equal(claimStep(rec, 'th_view'), false, 'a reload the same day is not');
assert.equal(claimStep(rec, 'th_datetime'), true);
rec = freshRecord(JSON.parse(JSON.stringify(rec)), '2026-10-20', false);
assert.equal(claimStep(rec, 'th_datetime'), false, 'Back then Continue again is not sent twice');
rec = freshRecord(rec, '2026-10-21', false);
assert.equal(claimStep(rec, 'th_view'), true, 'a new day counts again');

// ── The ad flag holds for the day ──
rec = freshRecord(null, '2026-10-20', true);
rec = freshRecord(rec, '2026-10-20', false);
assert.equal(rec.ad, true, 'a reload without the ad URL still counts as ad traffic');
rec = freshRecord(rec, '2026-10-21', false);
assert.equal(rec.ad, false, 'but not the next day');

// ── Bad stored data starts over ──
assert.deepEqual(freshRecord('junk', '2026-10-20', false), { day: '2026-10-20', ad: false, sent: [] });
assert.deepEqual(freshRecord({ day: '2026-10-20', sent: 'th_view' }, '2026-10-20', false).sent, []);
assert.deepEqual(freshRecord({ day: '2026-10-20', sent: ['th_view', 7] }, '2026-10-20', false).sent, ['th_view']);

// ── Every step the page sends is one the server keeps ──
for (const s of ['th_view', 'th_datetime', 'th_details', 'th_phone', 'th_submit', 'th_booked']) {
  assert.ok(TRY_AT_HOME_EVENTS.includes(s), `${s} must be in TRY_AT_HOME_EVENTS`);
  assert.ok(s.startsWith('th_'), `${s} must start with th_ so /api/track routes it`);
}

console.log('try-at-home-funnel self-check: all assertions passed');
