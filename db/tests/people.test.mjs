// Fixture test for v_people / mv_people (db/migrations/004_people.sql) and the SQL
// twin of the lead score. Runs against a real Postgres: a Neon TEST branch, never
// production. Everything happens inside one transaction that is rolled back, so
// the branch is left exactly as it was.
//
// Run: node db/tests/people.test.mjs
//      (reads DATABASE_URL_UNPOOLED + NEON_BRANCH from .env; refuses NEON_BRANCH=production)
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { leadScore, scoreSql } from '../../src/lib/leadscore.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const envFile = join(root, '.env');
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"(.*)"$/, '$1');
  }
}
const branch = process.env.NEON_BRANCH || '';
if (!branch || branch === 'production' || branch === 'main') {
  console.error(`Refusing to run: NEON_BRANCH is "${branch}". Point .env at a Neon test branch.`);
  process.exit(1);
}
const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!url) { console.error('DATABASE_URL_UNPOOLED is not set.'); process.exit(1); }

const NOW = new Date();
const ago = (h) => new Date(NOW.getTime() - h * 3600e3).toISOString();
const P = 'zzt5b';  // fixture id prefix
let n = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;

const c = new pg.Client({ connectionString: url });
await c.connect();
try {
  await c.query('BEGIN');

  const visitor = (id, o = {}) => c.query(
    `INSERT INTO visitors (visitor_id, person_id, first_seen, last_seen, is_bot, is_test) VALUES ($1,$2,$3,$4,$5,$6)`,
    [id, o.person ?? null, o.first ?? ago(500), o.last ?? ago(1), o.bot ?? false, o.test ?? false]);
  const session = (id, vid, h, o = {}) => c.query(
    `INSERT INTO sessions (session_id, visitor_id, started_at, last_at, source, medium, campaign, device, city, country)
     VALUES ($1,$2,$3,$3,$4,$5,$6,$7,$8,'IN')`,
    [id, vid, ago(h), o.source ?? 'direct', o.medium ?? 'none', o.campaign ?? null, o.device ?? 'mobile', o.city ?? 'Mumbai']);
  const event = (vid, sid, name, h, o = {}) => c.query(
    `INSERT INTO events (event_id, ts, visitor_id, session_id, name, page_view_id, product, currency, props)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)`,
    [uuid(), ago(h), vid, sid, name, o.pv ?? null, o.product ?? null, o.currency ?? null, JSON.stringify(o.props ?? {})]);
  const person = (id, o = {}) => c.query(
    `INSERT INTO people (person_id, phone, email, name, address1, city, first_seen, last_seen) VALUES ($1,$2,$3,$4,$5,$6,$7,$7)`,
    [id, o.phone ?? null, o.email ?? null, o.name ?? null, o.address1 ?? null, o.city ?? null, o.first ?? ago(0)]);

  // A — returning person on two devices: phone (2 visits) + laptop (1 visit).
  await person(`${P}a`, { phone: '+919000000001', name: 'Asha Rao' });
  await visitor(`${P}va1`, { person: `${P}a`, first: ago(100) });
  await visitor(`${P}va2`, { person: `${P}a`, first: ago(30) });
  await session(`${P}sa1`, `${P}va1`, 100, { source: 'instagram', medium: 'social', campaign: 'diwali' });
  await session(`${P}sa2`, `${P}va1`, 50, { source: 'google', medium: 'organic' });
  await session(`${P}sa3`, `${P}va2`, 20, { source: 'direct', medium: 'none', device: 'desktop', city: 'Pune' });
  const pv1 = uuid(), pv2 = uuid();
  await event(`${P}va1`, `${P}sa1`, 'page_view', 100, { pv: pv1 });
  await event(`${P}va1`, `${P}sa1`, 'product_view', 99.9, { pv: pv1, product: 'bag-x' });
  await event(`${P}va1`, `${P}sa1`, 'page_engaged', 99.8, { pv: pv1, props: { ms: 60000 } });
  await event(`${P}va1`, `${P}sa1`, 'page_engaged', 99.7, { pv: pv1, props: { ms: 120000 } }); // running total → 120k
  await event(`${P}va1`, `${P}sa2`, 'product_view', 50, { pv: pv2, product: 'bag-y' });
  await event(`${P}va1`, `${P}sa2`, 'page_engaged', 49.9, { pv: pv2, props: { ms: 30000 } });
  await event(`${P}va1`, `${P}sa2`, 'add_to_cart', 49.8, { props: { cart_total: 9000 }, currency: 'INR' });
  await event(`${P}va2`, `${P}sa3`, 'add_to_cart', 20, { props: { cart_total: 18000 }, currency: 'INR' }); // latest cart
  await event(`${P}va2`, `${P}sa3`, 'checkout_start', 19.9);
  await event(`${P}va2`, `${P}sa3`, 'phone', 19.8);

  // A2 — opened checkout but left no number: still at "cart" (checkout is not a stage of its own).
  await visitor(`${P}vc1`, { person: null, first: ago(5) });
  await session(`${P}sc1`, `${P}vc1`, 5);
  await event(`${P}vc1`, `${P}sc1`, 'page_view', 5, { pv: uuid() });
  await event(`${P}vc1`, `${P}sc1`, 'add_to_cart', 4.9, { props: { cart_total: 7000 } });
  await event(`${P}vc1`, `${P}sc1`, 'checkout_start', 4.8);

  // B — bought after carting: stage ordered, not a lead.
  await person(`${P}b`, { phone: '+919000000002', first: ago(1) });
  await visitor(`${P}vb`, { person: `${P}b`, first: ago(24 * 10) });
  await session(`${P}sb`, `${P}vb`, 24 * 10);
  await event(`${P}vb`, `${P}sb`, 'add_to_cart', 24 * 10, { props: { cart_total: 12000 } });
  await c.query(`INSERT INTO orders (order_id, store, created_at, person_id, currency, total, total_inr)
                 VALUES ('${P}o1','india',$1,'${P}b','INR',12000,12000),
                        ('${P}o2','india',$2,'${P}b','INR',5000,NULL)`, [ago(24 * 7), ago(24 * 2)]);

  // C — a test number: flagged, never scored.
  await person(`${P}c`, { phone: '+919000000003' });
  await c.query(`INSERT INTO test_people (person_id, note) VALUES ('${P}c', 'fixture')`);
  await visitor(`${P}vc`, { person: `${P}c` });
  await session(`${P}sc`, `${P}vc`, 2);
  await event(`${P}vc`, `${P}sc`, 'product_view', 2, { product: 'bag-z' });

  // D — reached payment but the only order was cancelled.
  await person(`${P}d`, { phone: '+919000000004', address1: '1 MG Road' });
  await visitor(`${P}vd`, { person: `${P}d` });
  await session(`${P}sd`, `${P}vd`, 5);
  await event(`${P}vd`, `${P}sd`, 'payment_start', 5);
  await c.query(`INSERT INTO orders (order_id, store, created_at, cancelled_at, person_id, currency, total, total_inr)
                 VALUES ('${P}o3','india',$1,$1,'${P}d','INR',7000,7000)`, [ago(4)]);

  // E — known person with no browser yet (e.g. from a Shopify order backfill).
  await person(`${P}e`, { email: 'e@example.com', first: ago(3) });

  // Anonymous browsers.
  await visitor(`${P}v1`);                                    // one page, gone → excluded
  await session(`${P}s1`, `${P}v1`, 3);
  await event(`${P}v1`, `${P}s1`, 'page_view', 3);
  await event(`${P}v1`, `${P}s1`, 'page_engaged', 2.9, { props: { ms: 4000 } });
  await visitor(`${P}v2`);                                    // two pages → included
  await session(`${P}s2`, `${P}v2`, 3);
  await event(`${P}v2`, `${P}s2`, 'page_view', 3);
  await event(`${P}v2`, `${P}s2`, 'page_view', 2.9);
  await visitor(`${P}v3`);                                    // one page + a product view → included
  await session(`${P}s3`, `${P}v3`, 3);
  await event(`${P}v3`, `${P}s3`, 'page_view', 3);
  await event(`${P}v3`, `${P}s3`, 'product_view', 3, { product: 'bag-x' });
  await visitor(`${P}v4`, { bot: true });                     // crawler: included, flagged
  await session(`${P}s4`, `${P}v4`, 3);
  for (let i = 0; i < 3; i++) await event(`${P}v4`, `${P}s4`, 'page_view', 3 - i / 10);
  await visitor(`${P}v5`);                                    // seen but never sent an event → excluded
  await visitor(`${P}v6`, { test: true });                    // test browser, two pages
  await session(`${P}s6`, `${P}v6`, 3);
  await event(`${P}v6`, `${P}s6`, 'page_view', 3);
  await event(`${P}v6`, `${P}s6`, 'page_view', 2);

  const { rows } = await c.query(
    `SELECT p.*, ${scoreSql('p', '$1::timestamptz')} AS score FROM v_people p WHERE p.id LIKE $2 OR p.id LIKE $3 ORDER BY p.id`,
    [NOW.toISOString(), `${P}%`, `v:${P}%`]);
  const by = Object.fromEntries(rows.map((r) => [r.id, r]));

  // Inclusion rule: every person; anonymous only beyond a single page view.
  assert.deepEqual(rows.map((r) => r.id).sort(), [
    `${P}a`, `${P}b`, `${P}c`, `${P}d`, `${P}e`, `v:${P}v2`, `v:${P}v3`, `v:${P}v4`, `v:${P}v6`, `v:${P}vc1`,
  ].sort());

  // Opened checkout without leaving a number: at "cart", not a stage of its own.
  assert.equal(by[`v:${P}vc1`].stage, 'cart');
  assert.equal(by[`v:${P}vc1`].checkout_reached, true);   // the lead score still credits it
  assert.ok(!rows.some((r) => r.stage === 'checkout'));

  // A: two devices, three visits → one returning person with the whole history.
  const a = by[`${P}a`];
  assert.equal(a.kind, 'person');
  assert.equal(a.visits, 3);
  assert.equal(a.is_returning, true);
  assert.equal(a.stage, 'phone');
  assert.equal(Number(a.cart_value), 18000);                 // latest cart, across devices
  assert.deepEqual(a.products, ['bag-x', 'bag-y']);
  assert.equal(Number(a.engaged_ms), 150000);               // max per page view, summed
  assert.equal(a.first_source, 'instagram');
  assert.equal(a.first_campaign, 'diwali');
  assert.equal(a.last_source, 'direct');
  assert.equal(a.device, 'desktop');
  assert.equal(a.city, 'Pune');                             // no typed city → last visit's geo
  assert.equal(a.checkout_reached, true);
  assert.equal(a.phone_given, true);
  assert.equal(new Date(a.first_seen).getTime(), new Date(ago(100)).getTime());
  assert.equal(a.is_bot, false);
  assert.equal(a.is_test, false);
  assert.equal(a.orders, 0);

  // B: ordered → stage ordered, value from total_inr (or INR total), days to buy.
  const b = by[`${P}b`];
  assert.equal(b.stage, 'ordered');
  assert.equal(b.orders, 2);
  assert.equal(Number(b.ltv), 17000);
  assert.equal(b.days_to_first_purchase, 3);
  assert.equal(b.is_returning, false);
  assert.equal(b.score, null);                               // ordered after the cart

  // C: test number is flagged; D: cancelled order still proves payment.
  assert.equal(by[`${P}c`].is_test, true);
  assert.equal(by[`${P}c`].score, null);
  assert.equal(by[`${P}d`].stage, 'payment');
  assert.equal(by[`${P}d`].orders, 0);
  assert.equal(Number(by[`${P}d`].ltv), 0);

  // E: no browser at all, still a row.
  assert.equal(by[`${P}e`].visits, 0);
  assert.equal(by[`${P}e`].stage, 'visited');

  // Anonymous rows.
  assert.equal(by[`v:${P}v2`].kind, 'visitor');
  assert.equal(by[`v:${P}v2`].stage, 'visited');
  assert.equal(by[`v:${P}v3`].stage, 'viewed');
  assert.equal(by[`v:${P}v4`].is_bot, true);
  assert.equal(by[`v:${P}v4`].score, null);
  assert.equal(by[`v:${P}v6`].is_test, true);

  // The SQL score and the TypeScript score agree on every row.
  for (const r of rows) assert.equal(r.score, leadScore(r, NOW), `score parity for ${r.id}`);
  assert.ok(a.score >= 50, `A should be hot, got ${a.score}`);

  // mv_people is the same rows once refreshed (inside this transaction).
  await c.query(`SELECT people_refresh('0 seconds')`);
  const mv = await c.query(`SELECT id, visits, stage, cart_value, engaged_ms FROM mv_people WHERE id LIKE $1 OR id LIKE $2 ORDER BY id`,
    [`${P}%`, `v:${P}%`]);
  assert.deepEqual(mv.rows.map((r) => r.id), rows.map((r) => r.id));
  assert.deepEqual(mv.rows.find((r) => r.id === `${P}a`), { id: `${P}a`, visits: 3, stage: 'phone', cart_value: '18000.00', engaged_ms: '150000' });
} finally {
  await c.query('ROLLBACK').catch(() => {});
  await c.end();
}

console.log('people (v_people / mv_people): all checks passed');
