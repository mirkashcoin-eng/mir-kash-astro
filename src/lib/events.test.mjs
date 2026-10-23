// Self-check for the event contract: what /api/collect accepts, how it cleans
// payloads, and how a visit's source is worked out.
// Run: node src/lib/events.test.mjs   (Node 23.6+ imports the .ts directly)
import assert from 'node:assert/strict';
import { cleanEvent, cleanPath, cleanProps, isEventName, isId, personIdFor, personKey, sourceMedium } from './events.ts';

const id = '3f2b8c1e-9a4d-4c2b-8e1f-0a1b2c3d4e5f';

// Known names and the vp_/cx_/th_ families pass; anything else is refused.
for (const n of ['page_view', 'add_to_cart', 'payment_failed', 'vp_shown', 'cx_saved', 'th_datetime']) assert.ok(isEventName(n), n);
for (const n of ['visit', 'Page_View', 'drop table', '', null, 'vp_', 'zz_thing']) assert.ok(!isEventName(n), String(n));

// An event without a real UUID can't be de-duplicated, so it's rejected.
assert.equal(cleanEvent({ id: 'abc', name: 'page_view' }), 'bad_event_id');
assert.equal(cleanEvent({ id, name: 'nope' }), 'unknown_event');
assert.equal(cleanEvent(null), 'not_object');

const ok = cleanEvent({ id: id.toUpperCase(), name: 'add_to_cart', ts: 1.8e12, page: '/products/tote?utm_source=x#top',
  product: 'tote', value: 12999.456, currency: 'inr', props: { colour: 'Rust', n: 2, nested: { a: 1 }, 'bad key': 1 } });
assert.equal(ok.event_id, id);                    // lower-cased so retries match
assert.equal(ok.page, '/products/tote');          // query + hash stripped
assert.equal(ok.value, 12999.46);
assert.equal(ok.currency, 'INR');
assert.deepEqual(ok.props, { colour: 'Rust', n: 2 }); // nested + bad keys dropped
assert.equal(cleanEvent({ id, name: 'page_view', ts: 5 }).client_ts, null); // absurd clock ignored

assert.equal(cleanPath('https://evil.example/x'), null);
assert.equal(Object.keys(cleanProps(Object.fromEntries(Array.from({ length: 40 }, (_, i) => ['k' + i, i])))).length, 20);

// Ids: uuids and the old mk- fallback ids are fine; junk isn't.
assert.ok(isId(id)); assert.ok(isId('mk-lq2x9k3abc12'));
assert.ok(!isId('short')); assert.ok(!isId('has spaces in it')); assert.ok(!isId(undefined));

// Source / medium — explicit UTM wins, then click ids, affiliate, referrer, direct.
const sm = (t) => { const r = sourceMedium(t); return `${r.source}/${r.medium}`; };
assert.equal(sm({ utm_source: 'Instagram', utm_medium: 'Story', referrer: 'https://google.com/' }), 'instagram/story');
assert.equal(sm({ utm_source: 'newsletter' }), 'newsletter/unknown');
assert.equal(sm({ gclid: 'x', referrer: 'https://www.google.com/' }), 'google/cpc');
assert.equal(sm({ fbclid: 'x', referrer: 'https://l.instagram.com/' }), 'instagram/paid_social');
assert.equal(sm({ fbclid: 'x' }), 'facebook/paid_social');
assert.equal(sm({ affiliate: 'PRIYA' }), 'affiliate:priya/affiliate');
assert.equal(sm({ referrer: 'https://www.google.co.in/' }), 'google/organic');
assert.equal(sm({ referrer: 'https://l.instagram.com/?u=x' }), 'instagram/social');
assert.equal(sm({ referrer: 'https://vogue.in/article' }), 'vogue.in/referral');
assert.equal(sm({}), 'direct/none');
assert.equal(sm({ referrer: 'not a url' }), 'direct/none');

// Identity — same rule as the original personKey, email fallback.
assert.equal(personKey('+91 77387 84781'), '7738784781');
assert.equal(personIdFor('+917738784781', 'a@b.co'), '7738784781');
assert.equal(personIdFor('', 'Priya@Example.com'), 'e:priya@example.com');
assert.equal(personIdFor('123', 'not-an-email'), '');

console.log('events: all checks passed');
