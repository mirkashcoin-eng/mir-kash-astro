// Self-check for the Try at Home phone banner test.
// Run: node src/lib/ab-test.test.mjs
import assert from 'node:assert/strict';

// Mirrors src/lib/ab-test.ts (kept inline, not imported, so this runs on plain Node
// without a TypeScript loader).
function assignVariant(o) {
  const force = (o.force ?? '').toUpperCase();
  if (force === 'A' || force === 'B') return { variant: force, setCookie: false, counted: false };
  if (o.bot) return { variant: 'A', setCookie: false, counted: false };
  if (o.cookie === 'A' || o.cookie === 'B') return { variant: o.cookie, setCookie: false, counted: true };
  return { variant: o.rand < 0.5 ? 'A' : 'B', setCookie: true, counted: true };
}
function zTest(xA, nA, xB, nB) {
  const pA = nA ? xA / nA : 0;
  const pB = nB ? xB / nB : 0;
  const p = nA + nB ? (xA + xB) / (nA + nB) : 0;
  const se = Math.sqrt(p * (1 - p) * (nA && nB ? 1 / nA + 1 / nB : 0));
  return { pA, pB, z: se ? (pB - pA) / se : 0 };
}
const MIN_PER_ARM = 750, MIN_DAYS = 14;
function verdict(a, b, days) {
  const pieces = zTest(a.choseP, a.visitors, b.choseP, b.visitors);
  const bookings = zTest(a.booked, a.visitors, b.booked, b.visitors);
  if (a.visitors >= 200 && b.visitors >= 200 && bookings.z <= -2.58) return 'stop_B';
  if (Math.min(a.visitors, b.visitors) < MIN_PER_ARM || days < MIN_DAYS) return 'not_enough';
  if (pieces.z >= 1.96) return 'B';
  if (pieces.z <= -1.96) return 'A';
  return 'no_difference';
}

// ── Assignment ──
assert.deepEqual(assignVariant({ bot: false, rand: 0.2 }), { variant: 'A', setCookie: true, counted: true }, 'new visitor, low draw → A');
assert.deepEqual(assignVariant({ bot: false, rand: 0.7 }), { variant: 'B', setCookie: true, counted: true }, 'new visitor, high draw → B');
assert.deepEqual(assignVariant({ cookie: 'B', bot: false, rand: 0.1 }), { variant: 'B', setCookie: false, counted: true }, 'a returning visitor keeps their version');
assert.deepEqual(assignVariant({ cookie: 'junk', bot: false, rand: 0.9 }), { variant: 'B', setCookie: true, counted: true }, 'a bad cookie is reassigned');
assert.deepEqual(assignVariant({ bot: true, rand: 0.9 }), { variant: 'A', setCookie: false, counted: false }, 'bots get A and are not counted');
assert.deepEqual(assignVariant({ cookie: 'B', bot: true, rand: 0.9 }).variant, 'A', 'a bot never sees B');
assert.deepEqual(assignVariant({ force: 'b', cookie: 'A', bot: false, rand: 0.1 }), { variant: 'B', setCookie: false, counted: false }, '?ab=B forces B, uncounted, cookie untouched');
assert.deepEqual(assignVariant({ force: 'A', bot: true, rand: 0.9 }), { variant: 'A', setCookie: false, counted: false });
assert.equal(assignVariant({ force: 'C', bot: false, rand: 0.9 }).variant, 'B', 'an unknown ?ab= is ignored');
// Roughly 50/50 over many draws.
let b = 0; for (let i = 0; i < 10000; i++) if (assignVariant({ bot: false, rand: Math.random() }).variant === 'B') b++;
assert.ok(b > 4700 && b < 5300, `split should be near 50/50, got ${b} B of 10000`);

// ── z-test ──
const z = zTest(330, 1000, 400, 1000);
assert.ok(Math.abs(z.z - 3.24) < 0.02, `33% vs 40% over 1000 each is z≈3.24, got ${z.z}`);
assert.ok(zTest(400, 1000, 330, 1000).z < 0, 'B lower gives negative z');
assert.equal(zTest(0, 0, 0, 0).z, 0, 'no data is not a result');
assert.equal(zTest(0, 100, 0, 100).z, 0, 'all zero is not a result');

// ── Verdict ──
const arm = (visitors, choseP, booked) => ({ visitors, choseP, booked });
assert.equal(verdict(arm(300, 100, 9), arm(300, 130, 9), 6), 'not_enough', 'too few visitors and too early');
assert.equal(verdict(arm(900, 297, 27), arm(900, 360, 27), 10), 'not_enough', 'enough visitors, but under two weeks');
assert.equal(verdict(arm(900, 297, 27), arm(700, 280, 21), 20), 'not_enough', 'the smaller version decides');
assert.equal(verdict(arm(900, 297, 27), arm(900, 360, 27), 15), 'B', 'B clearly ahead after two weeks');
assert.equal(verdict(arm(900, 360, 27), arm(900, 297, 27), 15), 'A', 'A clearly ahead');
assert.equal(verdict(arm(900, 297, 27), arm(900, 305, 27), 21), 'no_difference');
assert.equal(verdict(arm(300, 100, 18), arm(300, 130, 2), 4), 'stop_B', 'B clearly costing bookings stops it early');
assert.equal(verdict(arm(100, 30, 9), arm(100, 40, 0), 2), 'not_enough', 'too small to stop on');

console.log('ab-test self-check: all assertions passed');
