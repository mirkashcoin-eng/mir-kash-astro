// Self-check for the repeat Try at Home rule.
// Run: node src/lib/repeat-booking.test.mjs
import assert from 'node:assert/strict';

// Mirrors src/lib/repeat-booking.ts (kept inline, not imported, so this runs on
// plain Node without a TypeScript loader).
const REPEAT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
function last10(phone) {
  return (phone ?? '').replace(/\D/g, '').slice(-10);
}
function findRepeatOf(past, phone, now) {
  const want = last10(phone);
  if (want.length !== 10) return null;
  const open = past.filter((b) => {
    const at = Date.parse(b.createdAt);
    return !b.completed && last10(b.phone) === want && at <= now && now - at <= REPEAT_WINDOW_MS;
  });
  open.sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  return open[0] ?? null;
}

const now = Date.parse('2026-10-23T06:02:00Z');
const hoursAgo = (h) => new Date(now - h * 3600_000).toISOString();
const booking = (name, h, extra = {}) => ({ name, createdAt: hoursAgo(h), phone: '+919820012345', completed: false, eventId: `sch-${name}`, ...extra });

// No earlier booking: new.
assert.equal(findRepeatOf([], '+919820012345', now), null);

// #D145–#D148: each later request repeats the first, so Meta keeps one Schedule.
const d145 = booking('#D145', 2), d146 = booking('#D146', 1.5), d147 = booking('#D147', 1);
assert.equal(findRepeatOf([d147, d145, d146], '+919820012345', now)?.name, '#D145');
assert.equal(findRepeatOf([d145], '+919820012345', now)?.eventId, 'sch-#D145');

// Phone formats match on the last 10 digits.
assert.equal(findRepeatOf([booking('#D1', 1, { phone: '9820012345' })], '+91 98200 12345', now)?.name, '#D1');

// A different number is someone else.
assert.equal(findRepeatOf([booking('#D1', 1, { phone: '+919820099999' })], '+919820012345', now), null);

// A completed visit means the next booking is a new one.
assert.equal(findRepeatOf([booking('#D1', 24, { completed: true })], '+919820012345', now), null);
// ...but an open one alongside it still makes this a repeat.
assert.equal(findRepeatOf([booking('#D1', 48, { completed: true }), booking('#D2', 2)], '+919820012345', now)?.name, '#D2');

// More than 7 days later counts again; exactly 7 days is still a repeat.
assert.equal(findRepeatOf([booking('#D1', 7 * 24 + 1)], '+919820012345', now), null);
assert.equal(findRepeatOf([booking('#D1', 7 * 24)], '+919820012345', now)?.name, '#D1');

// Drafts with no phone, or a phone we can't read, never match.
assert.equal(findRepeatOf([booking('#D1', 1, { phone: null })], '+919820012345', now), null);
assert.equal(findRepeatOf([booking('#D1', 1, { phone: '' })], '', now), null);

console.log('repeat-booking: all checks passed');
