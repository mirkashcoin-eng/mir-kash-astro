// Self-check for the Firestore → Neon history mapping (scripts/lib/firestore-map.mjs):
// deterministic ids, anon handling, person linking, synthetic events, daily counters.
// Run: node scripts/migrate-firestore.test.mjs   (Node 23.6+ imports the .ts it uses)
import assert from 'node:assert/strict';
import {
  uuidv5, slug, toDate, isPhoneKey, personRow, sessionRow, eventsFor,
  legacyDailyRows, productStatsRows, plan, tally, PRODUCT_STATS_DAY,
} from './lib/firestore-map.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const t = (s) => new Date(`2026-0${s}Z`);

// uuidv5: the RFC 4122 test vector, then stable + distinct for our names.
assert.equal(uuidv5('www.example.com', '6ba7b810-9dad-11d1-80b4-00c04fd430c8'), '2ed6657d-e927-568b-95e1-2665a8aea6a2');
assert.match(uuidv5('a|page_view|'), UUID);
assert.equal(uuidv5('a|page_view|'), uuidv5('a|page_view|'));
assert.notEqual(uuidv5('a|page_view|'), uuidv5('b|page_view|'));

// Same slug as product_stats ids in src/lib/analytics.ts.
assert.equal(slug('The Tan Tote — Large!'), 'the-tan-tote-large');
assert.equal(slug(null), '');

// Timestamps arrive as Date, ISO, epoch ms, or a JSON-serialised Firestore Timestamp.
assert.equal(toDate({ _seconds: 1760000000, _nanoseconds: 5e8 }).toISOString(), '2025-10-09T08:53:20.500Z');
assert.equal(toDate({ seconds: 1760000000 }).getTime(), 1760000000000);
assert.equal(toDate('2026-01-02T00:00:00Z').toISOString(), '2026-01-02T00:00:00.000Z');
assert.equal(toDate({ toDate: () => t('1-01T00:00:00') }).getTime(), t('1-01T00:00:00').getTime());
for (const bad of [null, undefined, '', 'nope', {}]) assert.equal(toDate(bad), null);

assert.ok(isPhoneKey('9876543210'));
for (const k of ['anon:abc', '+919876543210', '98765', '']) assert.ok(!isPhoneKey(k), k);

// personRow: phone cleaned, email lower-cased, test flag from test_people, and
// first/last seen fall back to step stamps when firstSeen/lastSeen are missing.
const pr = personRow('9876543210', { phone: '+91 98765-43210', email: ' A@B.CO ', phoneAt: t('3-05T10:00:00'), cartAt: t('3-01T10:00:00') }, new Set(['9876543210']));
assert.equal(pr.phone, '+919876543210');
assert.equal(pr.email, 'a@b.co');
assert.equal(pr.is_test, true);
assert.equal(pr.first_seen.toISOString(), '2026-03-01T10:00:00.000Z');
assert.equal(pr.last_seen.toISOString(), '2026-03-05T10:00:00.000Z');

// sessionRow: first-touch source/medium through sourceMedium(); landing loses its query.
const sr = sessionRow('sid-00000001', { firstSeen: t('1-01T00:00:00'), referrer: 'https://l.instagram.com/x', landing: '/products/tote?fbx=1', country: 'in', bot: 'Googlebot' });
assert.deepEqual([sr.source, sr.medium, sr.landing, sr.country, sr.is_bot], ['instagram', 'social', '/products/tote', 'IN', true]);
assert.equal(sr.last_at.getTime(), sr.started_at.getTime());          // never before it started
const utm = sessionRow('sid-00000002', { firstSeen: t('1-01T00:00:00'), utmSource: 'Meta', utmMedium: 'Paid', utmCampaign: 'diwali', referrer: 'https://google.com/' });
assert.deepEqual([utm.source, utm.medium, utm.campaign], ['meta', 'paid', 'diwali']);

// eventsFor: one event per step, migrated ids derived from browser + step.
const lead = {
  firstSeen: t('2-01T10:00:00'), lastSeen: t('2-03T10:00:00'), landing: '/', pageViews: 7, pages: ['/', '/shop'],
  viewedAt: t('2-01T10:05:00'), viewed: ['Tan Tote', 'Mini Bag'], items: ['Tan Tote', 'Clutch'],
  cartAt: t('2-01T10:10:00'), cartValue: 30000, cartCurrency: 'inr',
  cart: { total: 30000, currency: 'INR', quantity: 3, lines: [{ title: 'Tan Tote', quantity: 2, price: 10000 }, { title: 'Clutch', quantity: 1, price: 10000 }] },
  phoneAt: t('2-02T09:00:00'), phone: '9876543210', addressAt: t('2-02T09:05:00'),
  bookingFlow: 'try_at_home', bookingStep: 'bags', bookingStepAt: t('2-03T09:00:00'), bookingBagsCount: 2,
};
const ev = eventsFor('sid-00000001', lead);
const names = ev.map((e) => `${e.name}:${e.product ?? ''}`);
assert.deepEqual(names, [
  'page_view:', 'product_view:tan-tote', 'product_view:mini-bag', 'product_view:clutch',
  'add_to_cart:tan-tote', 'add_to_cart:clutch', 'phone:', 'address:', 'booking_step:',
]);
assert.ok(ev.every((e) => UUID.test(e.event_id) && e.visitor_id === 'sid-00000001' && e.session_id === 'sid-00000001'));
assert.equal(new Set(ev.map((e) => e.event_id)).size, ev.length);
assert.deepEqual(eventsFor('sid-00000001', lead).map((e) => e.event_id), ev.map((e) => e.event_id)); // re-run = same ids
const by = (n, p) => ev.find((e) => e.name === n && (p == null || e.product === p));
assert.deepEqual(by('page_view').props, { page_views: 7, distinct_pages: 2 });
assert.equal(by('product_view', 'mini-bag').ts.getTime(), lead.viewedAt.getTime());
assert.equal(by('product_view', 'mini-bag').props.title, 'Mini Bag');
assert.equal(by('add_to_cart', 'tan-tote').value, 20000);               // its line: 2 × 10000
assert.equal(by('add_to_cart', 'tan-tote').currency, 'INR');
assert.equal(by('add_to_cart', 'tan-tote').props.bag_total, 30000);
assert.deepEqual(by('booking_step').props, { flow: 'try_at_home', step: 'bags', count: 2 });
assert.ok(!JSON.stringify(ev).includes('9876543210'));                 // no PII in events

// A cart with no item names becomes one add_to_cart worth the bag; no viewedAt → firstSeen.
const bare = eventsFor('sid-00000003', { firstSeen: t('2-01T10:00:00'), cartAt: t('2-01T11:00:00'), cartValue: 5000, viewed: ['X'] });
assert.equal(bare.find((e) => e.name === 'add_to_cart').value, 5000);
assert.equal(bare.find((e) => e.name === 'add_to_cart').product, null);
assert.equal(bare.find((e) => e.name === 'product_view').ts.getTime(), t('2-01T10:00:00').getTime());
// A people doc's booking object is read the same as a lead's flat fields.
const pb = eventsFor('sid-00000004', { firstSeen: t('2-01T10:00:00'), booking: { flow: 'private_viewing', step: 'datetime', date: '2026-02-09', slot: '11:00', at: t('2-01T12:00:00') } });
assert.deepEqual(pb.find((e) => e.name === 'booking_step').props, { flow: 'private_viewing', step: 'datetime', date: '2026-02-09', slot: '11:00' });
// Bot browsers' events are flagged; a doc with no timestamps yields nothing.
assert.ok(eventsFor('sid-00000005', { firstSeen: t('1-01T00:00:00'), bot: 'bingbot' }).every((e) => e.is_bot));
assert.deepEqual(eventsFor('sid-00000006', { landing: '/' }), []);

// Daily counters: numeric fields become rows; `day` and junk are dropped and tallied.
const sk = tally();
assert.deepEqual(
  legacyDailyRows('funnel_daily', { '2026-01-05': { day: '2026-01-05', visitors: 4, p1: 2, note: 'x' }, junk: { a: 1 } }, sk),
  [{ day: '2026-01-05', source: 'funnel_daily', metric: 'visitors', value: 4 }, { day: '2026-01-05', source: 'funnel_daily', metric: 'p1', value: 2 }],
);
assert.deepEqual(sk.t, { 'funnel_daily: non-numeric field': 1, 'funnel_daily: doc id is not a day': 1 });
assert.deepEqual(
  productStatsRows({ 'tan-tote': { title: 'Tan Tote', views: 10, cartAdds: 2, lastAt: t('1-01T00:00:00') } }, tally()),
  [{ day: PRODUCT_STATS_DAY, source: 'product_stats', metric: 'views:tan-tote', value: 10 },
    { day: PRODUCT_STATS_DAY, source: 'product_stats', metric: 'cartAdds:tan-tote', value: 2 }],
);

// plan(): the whole picture.
const S1 = 'aaaaaaaa-0000-0000-0000-000000000001'; // identified browser, has a lead doc
const S2 = 'aaaaaaaa-0000-0000-0000-000000000002'; // same person's second browser, no lead doc
const S3 = 'aaaaaaaa-0000-0000-0000-000000000003'; // anonymous browser (lead + anon people doc)
const S4 = 'aaaaaaaa-0000-0000-0000-000000000004'; // anon people doc only
const S5 = 'aaaaaaaa-0000-0000-0000-000000000005'; // lead gave a phone whose people doc is missing
const S6 = 'aaaaaaaa-0000-0000-0000-000000000006'; // person whose only browser has no lead doc
const out = plan({
  leads: {
    [S1]: { ...lead, sessionId: S1 },
    [S3]: { firstSeen: t('3-01T00:00:00'), cartAt: t('3-01T00:10:00'), items: ['Clutch'], referrer: 'https://www.google.com/' },
    [S5]: { firstSeen: t('4-01T00:00:00'), phone: '+91 99999 88888', phoneAt: t('4-01T00:05:00'), name: 'Lead Only' },
    'short': { firstSeen: t('1-01T00:00:00') },
  },
  people: {
    '9876543210': { phone: '9876543210', firstSeen: t('2-02T09:00:00'), lastSeen: t('2-05T00:00:00'), sessionIds: [S1, S2], name: 'Asha' },
    [`anon:${S3}`]: { firstSeen: t('3-01T00:00:00'), sessionIds: [S3], items: ['Clutch'] },
    [`anon:${S4}`]: { firstSeen: t('3-02T00:00:00'), sessionIds: [S4], viewed: ['Tan Tote'], viewedAt: t('3-02T00:01:00') },
    '7738784781': { phone: '7738784781', firstSeen: t('5-01T00:00:00'), sessionIds: [S6], phoneAt: t('5-01T00:02:00') },
    '1112223334': { phone: '1112223334', source: 'legacy-checkout', firstSeen: t('1-15T00:00:00'), phoneAt: t('1-15T00:00:00') },
    'weird-id': { firstSeen: t('1-01T00:00:00') },
  },
  funnel_daily: { '2026-01-05': { day: '2026-01-05', visitors: 3 } },
  analytics_daily: { '2026-01-05': { day: '2026-01-05', visit: 9, vp_shown: 2 } },
  product_stats: { clutch: { title: 'Clutch', views: 5 } },
}, new Set(['7738784781']));

// People: phone keys only — anon:* and odd ids are skipped, the lead-only phone is rebuilt.
assert.deepEqual(out.people.map((p) => p.person_id).sort(), ['1112223334', '7738784781', '9876543210', '9999988888']);
assert.equal(out.skipped['people: anon:* (a browser, not a person)'], 2);
assert.equal(out.skipped['people: id is not a 10-digit phone key'], 1);
assert.equal(out.notes['people: rebuilt from a lead doc (no people doc)'], 1);
assert.equal(out.people.find((p) => p.person_id === '9999988888').name, 'Lead Only');
// A person's first_seen widens to their earliest browser (S1 predates the people doc).
assert.equal(out.people.find((p) => p.person_id === '9876543210').first_seen.getTime(), lead.firstSeen.getTime());
assert.equal(out.people.find((p) => p.person_id === '7738784781').is_test, true);

// Visitors: one per old browser id, linked to its person; anon browsers stay unlinked.
const vis = Object.fromEntries(out.visitors.map((v) => [v.visitor_id, v]));
assert.equal(vis[S1].person_id, '9876543210');
assert.equal(vis[S2].person_id, '9876543210');                         // listed on the person, no lead
assert.equal(vis[S3].person_id, null);
assert.equal(vis[S4].person_id, null);
assert.equal(vis[S5].person_id, '9999988888');
assert.equal(vis[S6].is_test, true);
assert.equal(vis['p:1112223334'].person_id, '1112223334');              // legacy import: synthetic browser
assert.ok(!vis.short);
assert.equal(out.skipped['visitors: malformed browser id'], 1);

// Sessions: one per browser that has a describing doc. S2 has none (person has S1's lead).
const ses = new Set(out.sessions.map((s) => s.session_id));
assert.deepEqual([...ses].sort(), [S1, S3, S4, S5, S6, 'p:1112223334'].sort());
assert.equal(out.notes['visitors: no lead doc (visitor row only, no session/events)'], 1);
assert.equal(out.notes['sessions: built from the people doc (no lead doc)'], 1);  // S6
assert.equal(out.sessions.find((s) => s.session_id === S3).source, 'google');

// Events: each session's own, all with unique deterministic ids; a re-plan is identical.
assert.ok(out.events.every((e) => ses.has(e.session_id)));
assert.equal(new Set(out.events.map((e) => e.event_id)).size, out.events.length);
assert.ok(out.events.some((e) => e.session_id === S4 && e.name === 'product_view' && e.product === 'tan-tote'));
assert.ok(out.events.some((e) => e.session_id === 'p:1112223334' && e.name === 'phone'));
const again = plan({ leads: { [S1]: lead }, people: {} });
assert.deepEqual(again.events.map((e) => e.event_id), eventsFor(S1, lead).map((e) => e.event_id));

// Legacy counters from all three collections.
assert.deepEqual(out.legacy.map((r) => `${r.source}/${r.day}/${r.metric}=${r.value}`), [
  'funnel_daily/2026-01-05/visitors=3', 'analytics_daily/2026-01-05/visit=9', 'analytics_daily/2026-01-05/vp_shown=2',
  `product_stats/${PRODUCT_STATS_DAY}/views:clutch=5`,
]);

console.log('migrate-firestore: all checks passed');
