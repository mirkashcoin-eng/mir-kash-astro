// Self-check for the pure parts of the GA4 sync: report rows → ga_audience_daily
// rows, and which days each run pulls.
// Run: node src/lib/ga4.test.mjs
import assert from 'node:assert/strict';
import {
  GA_DIMENSIONS, gaDateToIso, localDate, addDays, dateRange, syncDays,
  reportToRows, mergeRows, isFieldRejection, parseServiceAccount, normalizePropertyId,
} from './ga4.ts';

const report = (metrics, rows, extraDims = []) => ({
  dimensionHeaders: [{ name: 'date' }, { name: 'userAgeBracket' }, ...extraDims],
  metricHeaders: metrics.map((name) => ({ name, type: 'TYPE_INTEGER' })),
  rows: rows.map(([d, v, ...m]) => ({
    dimensionValues: [{ value: d }, { value: v }],
    metricValues: m.map((x) => ({ value: x })),
  })),
});

// ---- Mapping ----------------------------------------------------------------

// Basic mapping: YYYYMMDD → ISO, metrics by header name (not position).
assert.deepEqual(
  reportToRows('age', report(['activeUsers', 'sessions', 'keyEvents'], [['20261019', '25-34', '40', '55', '2']])),
  [{ day: '2026-10-19', dimension: 'age', value: '25-34', users: 40, sessions: 55, conversions: 2 }],
);
assert.deepEqual(
  reportToRows('age', report(['sessions', 'keyEvents', 'activeUsers'], [['20261019', '25-34', '55', '2', '40']]))[0],
  { day: '2026-10-19', dimension: 'age', value: '25-34', users: 40, sessions: 55, conversions: 2 },
);

// Legacy `conversions` metric is accepted in place of keyEvents.
assert.equal(reportToRows('age', report(['activeUsers', 'sessions', 'conversions'], [['20261019', '18-24', '3', '4', '1']]))[0].conversions, 1);

// No conversions metric at all → null, never a made-up 0.
assert.equal(reportToRows('age', report(['activeUsers', 'sessions'], [['20261019', '18-24', '3', '4']]))[0].conversions, null);

// keyEvents can come back as a decimal string; stored as an integer.
assert.equal(reportToRows('age', report(['activeUsers', 'sessions', 'keyEvents'], [['20261019', '18-24', '3', '4', '2.0']]))[0].conversions, 2);

// Thresholding: GA's placeholder values are stored verbatim, and groups GA withheld
// simply have no row — nothing is filled in.
{
  const rows = reportToRows('age', report(['activeUsers', 'sessions', 'keyEvents'], [
    ['20261019', '(other)', '12', '14', '0'],
    ['20261019', 'unknown', '30', '31', '1'],
    ['20261019', '(not set)', '5', '5', '0'],
  ]));
  assert.deepEqual(rows.map((r) => r.value), ['(other)', 'unknown', '(not set)']);
  assert.equal(rows.length, 3); // no 18-24, 25-34… rows invented
}
assert.deepEqual(reportToRows('age', { dimensionHeaders: [{ name: 'date' }, { name: 'userAgeBracket' }], metricHeaders: [{ name: 'activeUsers' }, { name: 'sessions' }] }), []);

// Unreadable rows are dropped, not guessed.
{
  const rows = reportToRows('age', report(['activeUsers', 'sessions', 'keyEvents'], [
    ['2026-10-19', '25-34', '1', '1', '0'],   // bad date format
    ['20261019', '25-34', '', '1', '0'],      // missing users
    ['20261019', '35-44', 'abc', '1', '0'],   // non-numeric
    ['20261019', '45-54', '7', '9', '0'],
  ]));
  assert.deepEqual(rows.map((r) => r.value), ['45-54']);
}

// A report missing a required metric header maps to nothing (can't tell users from sessions).
assert.deepEqual(reportToRows('age', report(['activeUsers'], [['20261019', '25-34', '4']])), []);

// Duplicate (day, value) — e.g. two cities with the same name — are summed.
{
  const rows = reportToRows('city', {
    dimensionHeaders: [{ name: 'date' }, { name: 'city' }],
    metricHeaders: [{ name: 'activeUsers' }, { name: 'sessions' }, { name: 'keyEvents' }],
    rows: [
      { dimensionValues: [{ value: '20261019' }, { value: 'Hyderabad' }], metricValues: [{ value: '10' }, { value: '12' }, { value: '1' }] },
      { dimensionValues: [{ value: '20261019' }, { value: 'Hyderabad' }], metricValues: [{ value: '2' }, { value: '3' }, { value: '0' }] },
      { dimensionValues: [{ value: '20261020' }, { value: 'Hyderabad' }], metricValues: [{ value: '1' }, { value: '1' }, { value: '0' }] },
    ],
  });
  assert.deepEqual(rows, [
    { day: '2026-10-19', dimension: 'city', value: 'Hyderabad', users: 12, sessions: 15, conversions: 1 },
    { day: '2026-10-20', dimension: 'city', value: 'Hyderabad', users: 1, sessions: 1, conversions: 0 },
  ]);
}

// mergeRows across pages; a null conversions anywhere keeps the sum null.
{
  const a = { day: '2026-10-19', dimension: 'city', value: 'Pune', users: 1, sessions: 2, conversions: 1 };
  const b = { ...a, users: 3, sessions: 4, conversions: null };
  const merged = mergeRows([a, b]);
  assert.deepEqual(merged, [{ ...a, users: 4, sessions: 6, conversions: null }]);
  assert.equal(a.users, 1); // inputs not mutated
}

assert.equal(gaDateToIso('20260101'), '2026-01-01');
assert.equal(gaDateToIso('(other)'), null);

// Dimension keys are unique and the ones the migration comment promises exist.
{
  const keys = GA_DIMENSIONS.map((d) => d.key);
  assert.equal(new Set(keys).size, keys.length);
  for (const k of ['age', 'gender', 'interest', 'device', 'city']) assert.ok(keys.includes(k), k);
}

// ---- Date ranges --------------------------------------------------------------

// IST calendar date: 20:00 UTC on the 20th is already the 21st in India.
assert.equal(localDate(new Date('2026-10-20T20:00:00Z')), '2026-10-21');
assert.equal(localDate(new Date('2026-10-20T18:00:00Z')), '2026-10-20');
assert.equal(addDays('2026-03-01', -1), '2026-02-28');
assert.equal(addDays('2024-12-31', 1), '2025-01-01');

// Cron at 02:00 IST on the 21st → 3 complete days, 18th..20th (today excluded).
assert.deepEqual(dateRange(new Date('2026-10-20T20:30:00Z'), 3), { startDate: '2026-10-18', endDate: '2026-10-20' });
assert.deepEqual(dateRange(new Date('2026-10-20T20:30:00Z'), 1), { startDate: '2026-10-20', endDate: '2026-10-20' });
// 90-day backfill spans exactly 90 days.
{
  const r = dateRange(new Date('2026-10-20T20:30:00Z'), 90);
  assert.equal(r.endDate, '2026-10-20');
  assert.equal(r.startDate, addDays('2026-10-20', -89));
  assert.equal((Date.parse(r.endDate) - Date.parse(r.startDate)) / 864e5 + 1, 90);
}

assert.equal(syncDays(true), 90);
assert.equal(syncDays(false), 3);
assert.equal(syncDays(false, 30), 30);
assert.equal(syncDays(true, 1000), 365);
assert.equal(syncDays(false, 0), 3);       // invalid override ignored
assert.equal(syncDays(false, NaN), 3);
assert.equal(syncDays(false, null), 3);

// ---- Config parsing -------------------------------------------------------------

assert.equal(normalizePropertyId('123456789'), '123456789');
assert.equal(normalizePropertyId(' properties/123456789 '), '123456789');
assert.equal(normalizePropertyId('G-FZN0YD1X1R'), null); // measurement id is not the property id
assert.equal(normalizePropertyId(''), null);

{
  const sa = { client_email: 'x@p.iam.gserviceaccount.com', private_key: '-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----\\n' };
  const raw = parseServiceAccount(JSON.stringify(sa));
  assert.equal(raw.client_email, sa.client_email);
  assert.ok(raw.private_key.includes('\nabc\n')); // escaped newlines normalised
  const b64 = parseServiceAccount(Buffer.from(JSON.stringify(sa)).toString('base64'));
  assert.equal(b64.client_email, sa.client_email);
  assert.equal(parseServiceAccount(''), null);
  assert.equal(parseServiceAccount('not json'), null);
  assert.equal(parseServiceAccount('{"client_email":"x"}'), null);
}

assert.ok(isFieldRejection(400, '{"error":{"status":"INVALID_ARGUMENT","message":"Field keyEvents is not a valid metric."}}'));
assert.ok(!isFieldRejection(403, 'PERMISSION_DENIED'));
assert.ok(!isFieldRejection(429, 'RESOURCE_EXHAUSTED'));

console.log('ga4: all assertions passed');
