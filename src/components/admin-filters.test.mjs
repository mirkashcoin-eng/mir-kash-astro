// Self-check for the People date filter and the unread nav badges.
// Run: node src/components/admin-filters.test.mjs
import assert from 'node:assert/strict';

const IST_MS = 5.5 * 3600000;

// Mirrors istMidnight() in AdminDashboard.astro: midnight IST, N days back.
function istMidnight(daysAgo, now = new Date()) {
  const nowIst = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  nowIst.setHours(0, 0, 0, 0);
  nowIst.setDate(nowIst.getDate() - (daysAgo || 0));
  return nowIst.getTime() - nowIst.getTimezoneOffset() * 60000 - IST_MS;
}

// The boundary must be a real IST midnight, not the browser's local midnight —
// otherwise "today" means different things depending on where you're sitting.
const midnight = istMidnight(0);
const asIst = new Date(midnight + IST_MS).toISOString();
assert.ok(asIst.endsWith('T00:00:00.000Z'), `IST midnight should land on 00:00 IST, got ${asIst}`);
// Going back N days moves exactly N days.
assert.equal(istMidnight(0) - istMidnight(7), 7 * 864e5, 'seven days back is seven days');

// Mirrors inRange(): lastSeen decides, firstSeen is the fallback.
function inRange(p, range) {
  if (!range) return true;
  const t = new Date(p.lastSeen || p.firstSeen || 0).getTime();
  if (!isFinite(t) || !t) return false;
  if (range.from && t < range.from) return false;
  if (range.to && t > range.to) return false;
  return true;
}
const day = 864e5;
const range = { from: midnight - 7 * day, to: midnight + day - 1 };
assert.ok(inRange({ lastSeen: new Date(midnight).toISOString() }, range), 'today is inside last-7-days');
assert.ok(!inRange({ lastSeen: new Date(midnight - 30 * day).toISOString() }, range), 'a month ago is outside');
assert.ok(inRange({ lastSeen: null, firstSeen: new Date(midnight).toISOString() }, range), 'falls back to firstSeen');
assert.ok(!inRange({ lastSeen: null, firstSeen: null }, range), 'undated rows drop out of a range');
assert.ok(inRange({ lastSeen: null, firstSeen: null }, null), 'but survive "All time"');
// An inclusive `to` must keep the whole final day.
const endOfDay = { from: null, to: midnight + day - 1 };
assert.ok(inRange({ lastSeen: new Date(midnight + day - 1000).toISOString() }, endOfDay), 'late that day still counts');

// "Yesterday" is the one preset closed at both ends: it must contain all of
// yesterday and none of today.
const yest = { from: istMidnight(1), to: istMidnight(0) - 1 };
const stamp = (ms) => ({ lastSeen: new Date(ms).toISOString() });
assert.ok(inRange(stamp(istMidnight(1)), yest), 'yesterday 00:00 is in');
assert.ok(inRange(stamp(istMidnight(0) - 1), yest), 'yesterday 23:59:59.999 is in');
assert.ok(!inRange(stamp(istMidnight(0)), yest), 'today 00:00 is out');
assert.ok(!inRange(stamp(istMidnight(2)), yest), 'the day before is out');
// Today and yesterday must not overlap, or rows would be counted in both.
assert.ok(!inRange(stamp(istMidnight(0)), yest) && inRange(stamp(istMidnight(0)), { from: istMidnight(0), to: null }),
  'the boundary instant belongs to today alone');

// Mirrors unreadCount(): only records newer than the mark.
function unreadCount(mark, rows, stamp) {
  if (!mark) return 0;
  return rows.filter((r) => {
    const t = new Date(stamp(r) || 0).getTime();
    return isFinite(t) && t > mark;
  }).length;
}
const seen = midnight;
const rows = [
  { createdAt: new Date(seen + 60000).toISOString() },  // after → unread
  { createdAt: new Date(seen + 120000).toISOString() }, // after → unread
  { createdAt: new Date(seen - 60000).toISOString() },  // before → already read
  { createdAt: null },                                   // undated → not "new"
];
assert.equal(unreadCount(seen, rows, (r) => r.createdAt), 2, 'counts only what arrived since');
// First visit has no mark: showing the whole backlog as "new" would be noise.
assert.equal(unreadCount(undefined, rows, (r) => r.createdAt), 0, 'no mark yet → no badge');
// Opening the tab now clears it.
assert.equal(unreadCount(Date.now(), rows, (r) => r.createdAt), 0, 'marking seen clears the badge');

console.log('admin-filters self-check: all assertions passed');
