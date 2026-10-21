// Pure mapping from the old Firestore analytics docs to Neon rows, for
// scripts/migrate-firestore.mjs. No I/O: docs in (plain objects, timestamps as Date /
// ISO string / Firestore Timestamp), rows out — so the tests can check every rule
// without Firestore or a database. Run the tests: node scripts/migrate-firestore.test.mjs
//
// The shape of the old data (see src/lib/leads.ts):
//   leads/{mk_sid}   one doc per browser (the old "session" id lived in localStorage
//                    forever, so it is really a browser), with first-touch fields and
//                    the time each step was LAST/FIRST reached.
//   people/{key}     key = last 10 phone digits, or `anon:{mk_sid}` for a browser that
//                    never gave a number. sessionIds[] = every mk_sid linked to them.
//
// How it lands in Neon:
//   people   — phone-keyed docs only. anon:* are browsers, not people.
//   visitors — one per old mk_sid (visitor_id = the mk_sid itself), linked to the
//              person whose phone it gave. The new tracker keeps a SEPARATE id
//              (`mk_vid`), so an old browser and the same browser's new visitor row
//              stay two visitors until the person identifies again on the new tracker
//              (then both carry the same person_id and stitch at query time).
//   sessions — ONE per old browser (session_id = mk_sid): the old data has no visit
//              boundaries, so all of a browser's history is one "session" carrying its
//              first-touch attribution.
//   events   — synthesized (migrated = true) from the step timestamps. See eventsFor().
//   legacy_daily — the daily counters, as they were, for days before the event log.
import { createHash } from 'node:crypto';
import { cleanPath, personKey, sourceMedium, str } from '../../src/lib/events.ts';

// ── Small helpers ─────────────────────────────────────────────────────────────

// Fixed namespace for migrated event ids. Never change it: re-runs rely on the same
// input producing the same ids, so ON CONFLICT DO NOTHING skips what's already there.
export const MIGRATION_NS = '6d1f3c2a-8b4e-5a7d-9c0f-4e2b1a3d5c6e';

// RFC 4122 version-5 UUID (SHA-1 of namespace + name).
export function uuidv5(name, ns = MIGRATION_NS) {
  const nsBytes = Buffer.from(ns.replace(/-/g, ''), 'hex');
  const h = createHash('sha1').update(nsBytes).update(String(name), 'utf8').digest();
  h[6] = (h[6] & 0x0f) | 0x50;
  h[8] = (h[8] & 0x3f) | 0x80;
  const x = h.subarray(0, 16).toString('hex');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}

// Same slug product_stats used for its doc ids (src/lib/analytics.ts), so a migrated
// product_view and the product's legacy counters share one key.
export function slug(title) {
  return String(title ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 120);
}

// Firestore Timestamp (live or JSON-serialised), Date, ISO string or epoch ms → Date.
export function toDate(v) {
  if (v == null || v === '') return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  if (typeof v.toDate === 'function') return toDate(v.toDate());
  if (typeof v === 'object') {
    const s = v.seconds ?? v._seconds;
    return typeof s === 'number' ? new Date(s * 1000 + Math.round((v.nanoseconds ?? v._nanoseconds ?? 0) / 1e6)) : null;
  }
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

export const isPhoneKey = (id) => /^\d{10}$/.test(String(id));
export const ANON_PREFIX = 'anon:';
const isDay = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s));
const arr = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x.trim()) : []);
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const minDate = (...ds) => ds.filter(Boolean).reduce((a, b) => (!a || b < a ? b : a), null);
const maxDate = (...ds) => ds.filter(Boolean).reduce((a, b) => (!a || b > a ? b : a), null);

// Every step timestamp a lead/people doc may carry, for first/last-seen fallbacks.
const STAMPS = ['firstSeen', 'lastSeen', 'visitAt', 'viewedAt', 'cartAt', 'phoneAt', 'addressAt', 'bookingStepAt', 'intentAt'];
function stamps(v) {
  const out = STAMPS.map((k) => toDate(v[k]));
  if (v.booking && typeof v.booking === 'object') out.push(toDate(v.booking.at));
  return out.filter(Boolean);
}
const firstOf = (v) => toDate(v.firstSeen) ?? minDate(...stamps(v));
const lastOf = (v) => toDate(v.lastSeen) ?? maxDate(...stamps(v));

// A tally of why something was dropped (or kept with a caveat), for the summary.
export function tally() {
  const t = {};
  return { t, add: (reason, n = 1) => { t[reason] = (t[reason] || 0) + n; } };
}

// ── Rows ──────────────────────────────────────────────────────────────────────

// people row from a phone-keyed people doc (or, when there is none, from a lead doc
// that gave that phone). Same field limits as /api/collect.
export function personRow(id, v, testIds) {
  return {
    person_id: id,
    phone: String(v.phone ?? '').replace(/[^0-9+]/g, '').slice(0, 20) || id,
    email: str(v.email, 200)?.toLowerCase() ?? null,
    name: str(v.name, 120),
    address1: str(v.address1, 200),
    city: str(v.city, 80),
    province: str(v.province, 80),
    pin: str(v.pin, 10),
    first_seen: firstOf(v),
    last_seen: lastOf(v),
    is_test: testIds.has(id),
  };
}

// The one session of an old browser, with its first-touch attribution.
export function sessionRow(sid, v) {
  const touch = { referrer: str(v.referrer, 300), utm_source: str(v.utmSource, 60), utm_medium: str(v.utmMedium, 60) };
  const sm = sourceMedium(touch);
  const started = firstOf(v);
  return {
    session_id: sid,
    visitor_id: sid,
    started_at: started,
    last_at: maxDate(lastOf(v), started),
    landing: cleanPath(v.landing),
    referrer: touch.referrer,
    source: sm.source,
    medium: sm.medium,
    campaign: str(v.utmCampaign, 80),
    country: str(v.country, 2)?.toUpperCase() ?? null,
    market: str(v.market, 16),
    is_bot: Boolean(v.bot),
  };
}

// Synthetic events for one old browser, from the doc that describes it (its lead doc,
// or — when that's missing — the people doc that owns it).
//
// The timestamps are APPROXIMATE. Firestore kept one time per step, not one per
// action: firstSeen is when the browser was first seen, viewedAt is when the LAST
// product page was opened (so every product_view gets that one time, or firstSeen
// when it's missing), cartAt/phoneAt/addressAt are when that step was reached, and a
// booking keeps only its furthest step. Counts per person and the order of steps are
// right; exact times within a visit, repeat views and page-by-page paths are not.
//
// Ids are uuidv5(`${sid}|${name}|${key}`), so a re-run yields the same ids and
// inserts nothing new.
export function eventsFor(sid, v) {
  const out = [];
  const isBot = Boolean(v.bot);
  const first = firstOf(v);
  const ev = (name, key, ts, extra = {}) => {
    if (!ts) return;
    out.push({
      event_id: uuidv5(`${sid}|${name}|${key}`),
      ts,
      visitor_id: sid,
      session_id: sid,
      name,
      page: null,
      product: null,
      value: null,
      currency: null,
      props: {},
      is_bot: isBot,
      ...extra,
    });
  };

  // Arrival. Only the landing page is known; how many pages followed rides along in props.
  const props = {};
  if (num(v.pageViews) != null) props.page_views = v.pageViews;
  if (arr(v.pages).length) props.distinct_pages = arr(v.pages).length;
  ev('page_view', '', first, { page: cleanPath(v.landing), props });

  // Product views: every product opened, plus anything bagged (a bagged product was
  // necessarily seen — same rule as toPerson() in leads.ts). Keyed by slug of title.
  const titles = new Map();
  for (const t of [...arr(v.viewed), ...arr(v.items)]) { const s = slug(t); if (s && !titles.has(s)) titles.set(s, t); }
  const viewedAt = maxDate(toDate(v.viewedAt) ?? first, first);
  for (const [s, t] of titles) ev('product_view', s, viewedAt, { product: s, props: { title: str(t, 200) } });

  // Cart: one add_to_cart per bagged product, valued at its line in the last-known bag
  // (the event contract's "value = line value"); the whole bag's total rides along as
  // props.bag_total. A cart with no item names becomes one event worth the bag total.
  const cartAt = toDate(v.cartAt);
  if (cartAt) {
    const cart = v.cart && typeof v.cart === 'object' ? v.cart : null;
    const currency = str(v.cartCurrency ?? cart?.currency, 8)?.toUpperCase() || 'INR';
    const bagTotal = num(v.cartValue) ?? num(cart?.total);
    const lines = new Map();
    for (const l of Array.isArray(cart?.lines) ? cart.lines : []) {
      const s = slug(l?.title);
      if (!s) continue;
      const line = (num(l.price) ?? 0) * (num(l.quantity) ?? 1);
      lines.set(s, { title: l.title, value: (lines.get(s)?.value ?? 0) + line });
    }
    const bagged = new Map([...arr(v.items).map((t) => [slug(t), t]), ...[...lines].map(([s, l]) => [s, l.title])]);
    bagged.delete('');
    const total = bagTotal != null ? { bag_total: bagTotal } : {};
    for (const [s, t] of bagged) {
      const value = lines.has(s) ? Math.round(lines.get(s).value * 100) / 100 : null;
      ev('add_to_cart', s, cartAt, { product: s, value, currency, props: { title: str(t, 200), ...total } });
    }
    if (!bagged.size) ev('add_to_cart', '', cartAt, { value: bagTotal, currency, props: total });
  }

  // Funnel steps. No PII in events — the number/address itself stays in `people`.
  ev('phone', '', toDate(v.phoneAt));
  ev('address', '', toDate(v.addressAt));

  // Booking: lead docs store it flat, people docs as a `booking` object. Only the
  // furthest step reached survives, so this is one event per browser.
  const b = v.booking && typeof v.booking === 'object' ? v.booking : null;
  const flow = str(v.bookingFlow ?? b?.flow, 20);
  const step = str(v.bookingStep ?? b?.step, 20);
  if (flow && step) {
    const bp = { flow, step };
    const date = str(v.bookingDate ?? b?.date, 20), slot = str(v.bookingSlot ?? b?.slot, 40);
    const count = num(v.bookingBagsCount ?? b?.count);
    if (date) bp.date = date;
    if (slot) bp.slot = slot;
    if (count != null) bp.count = count;
    ev('booking_step', '', toDate(v.bookingStepAt ?? b?.at) ?? lastOf(v), { props: bp });
  }
  return out;
}

// ── Daily counters ────────────────────────────────────────────────────────────

// funnel_daily / analytics_daily: one doc per IST day, every numeric field a counter.
export function legacyDailyRows(source, docs, skip) {
  const rows = [];
  for (const [id, v] of Object.entries(docs)) {
    const day = isDay(v.day) ? v.day : id;
    if (!isDay(day)) { skip.add(`${source}: doc id is not a day`); continue; }
    for (const [metric, value] of Object.entries(v)) {
      if (metric === 'day') continue;
      if (num(value) == null) { skip.add(`${source}: non-numeric field`); continue; }
      rows.push({ day, source, metric, value });
    }
  }
  return rows;
}

// product_stats holds ALL-TIME totals per product, not per day, so they go on a
// sentinel day — PRODUCT_STATS_DAY — as `{field}:{slug}` (e.g. `views:tan-tote`).
// Not lastAt's date: that would make a date-range sum count a lifetime total as one
// day's views, and a re-run after lastAt moved would leave a stale second row.
export const PRODUCT_STATS_DAY = '1970-01-01';
export function productStatsRows(docs, skip) {
  const rows = [];
  for (const [id, v] of Object.entries(docs)) {
    for (const [field, value] of Object.entries(v)) {
      if (field === 'title' || field === 'lastAt') continue;
      if (num(value) == null) { skip.add('product_stats: non-numeric field'); continue; }
      rows.push({ day: PRODUCT_STATS_DAY, source: 'product_stats', metric: `${field}:${id}`, value });
    }
  }
  return rows;
}

// ── The whole plan ────────────────────────────────────────────────────────────

const validSid = (s) => typeof s === 'string' && s.length >= 8 && s.length <= 100 && !s.startsWith(ANON_PREFIX);

// input: { leads, people, funnel_daily, analytics_daily, product_stats } — each an
// object of docId → data — plus testIds (Set of person_ids from test_people).
// Returns the rows for each table and a tally of what was skipped (dropped) and noted
// (kept, with a caveat).
export function plan(input, testIds = new Set()) {
  const leads = input.leads ?? {}, peopleDocs = input.people ?? {};
  const skipped = tally(), notes = tally();

  // People: phone-keyed docs. anon:* docs are kept aside — they describe a browser.
  const people = new Map();
  const anon = new Map();                 // mk_sid → anon people doc
  const owners = new Map();               // mk_sid → [phone person ids listing it]
  for (const [id, v] of Object.entries(peopleDocs)) {
    if (id.startsWith(ANON_PREFIX)) {
      anon.set(id.slice(ANON_PREFIX.length), v);
      skipped.add('people: anon:* (a browser, not a person)');
      continue;
    }
    if (!isPhoneKey(id)) { skipped.add('people: id is not a 10-digit phone key'); continue; }
    people.set(id, personRow(id, v, testIds));
    for (const sid of arr(v.sessionIds)) owners.set(sid, [...(owners.get(sid) ?? []), id]);
  }

  // Every old browser id we know of: lead docs, plus ids only listed on a people doc.
  const sids = new Set(Object.keys(leads));
  for (const sid of owners.keys()) sids.add(sid);
  for (const sid of anon.keys()) sids.add(sid);

  const visitors = [], sessions = [], events = [];
  const personOf = (sid) => {
    // The phone the browser itself gave wins (it's the latest one entered there);
    // else the most recently active person listing this browser.
    const own = personKey(leads[sid]?.phone);
    const listed = owners.get(sid) ?? [];
    if (listed.length > 1) notes.add('visitors: listed under several people (linked to one)');
    if (own) return own;
    return listed.sort((a, b) => (people.get(b).last_seen ?? 0) - (people.get(a).last_seen ?? 0))[0] ?? '';
  };
  // A phone person whose browsers all lack lead docs still has a history on their
  // people doc; it's replayed onto one of those browsers (the first by id).
  const replayed = new Set();

  for (const sid of [...sids].sort()) {
    if (!validSid(sid)) { skipped.add('visitors: malformed browser id'); continue; }
    let personId = personOf(sid);
    if (personId && !people.has(personId)) {
      // A lead gave a phone but its people doc is gone/unread: rebuild the person from the lead.
      if (leads[sid]) { people.set(personId, personRow(personId, leads[sid], testIds)); notes.add('people: rebuilt from a lead doc (no people doc)'); }
      else personId = '';
    }
    let doc = leads[sid] ?? anon.get(sid);
    if (!doc && personId && !replayed.has(personId)) {
      const pdoc = peopleDocs[personId];
      const hasLead = arr(pdoc?.sessionIds).some((s) => leads[s]);
      if (!hasLead) { doc = pdoc; replayed.add(personId); notes.add('sessions: built from the people doc (no lead doc)'); }
    }
    const p = personId ? people.get(personId) : null;
    const first = (doc && firstOf(doc)) ?? p?.first_seen ?? null;
    const last = maxDate((doc && lastOf(doc)) ?? p?.last_seen, first);
    if (!first) { skipped.add('visitors: no timestamp at all'); continue; }
    visitors.push({
      visitor_id: sid,
      person_id: personId || null,
      first_seen: first,
      last_seen: last,
      is_bot: Boolean(doc?.bot),
      bot_name: str(doc?.bot, 60),
      is_test: Boolean(p?.is_test),
    });
    if (!doc) { notes.add('visitors: no lead doc (visitor row only, no session/events)'); continue; }
    sessions.push(sessionRow(sid, doc));
    events.push(...eventsFor(sid, doc));
    // A person was around at least as long as each of their browsers.
    if (p) { p.first_seen = minDate(p.first_seen, first); p.last_seen = maxDate(p.last_seen, last); }
  }

  // Phone people with no browser at all (e.g. the legacy checkout import): a synthetic
  // browser `p:{person_id}` carries their steps so their timeline isn't empty.
  for (const [id, p] of people) {
    const v = peopleDocs[id];
    if (!v || arr(v.sessionIds).some(validSid)) continue;
    const sid = `p:${id}`;
    const first = firstOf(v);
    if (!first) { skipped.add('people: no browser and no timestamp (person row only)'); continue; }
    visitors.push({ visitor_id: sid, person_id: id, first_seen: first, last_seen: maxDate(lastOf(v), first),
      is_bot: Boolean(v.bot), bot_name: str(v.bot, 60), is_test: p.is_test });
    sessions.push(sessionRow(sid, v));
    events.push(...eventsFor(sid, v));
    notes.add('people: no browser id, synthetic visitor p:{id}');
  }

  for (const p of people.values()) {
    if (!p.first_seen) notes.add('people: no timestamp (first/last_seen = migration time)');
  }

  const legacy = [
    ...legacyDailyRows('funnel_daily', input.funnel_daily ?? {}, skipped),
    ...legacyDailyRows('analytics_daily', input.analytics_daily ?? {}, skipped),
    ...productStatsRows(input.product_stats ?? {}, skipped),
  ];

  return { people: [...people.values()], visitors, sessions, events, legacy, skipped: skipped.t, notes: notes.t };
}
