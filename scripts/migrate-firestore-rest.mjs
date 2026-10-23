// One-time copy of the small Firestore collections into Neon: affiliate links, their clicks,
// the newsletter list (005_affiliates.sql), and Team access, the coupon redemption ledger and
// customers' saved addresses (008_firestore_exit.sql). Read-only on Firestore, idempotent on
// Neon: a re-run adds what is missing and changes nothing else.
// Run: node scripts/migrate-firestore-rest.mjs [--dry-run]
//
// Firestore credentials: FIREBASE_SERVICE_ACCOUNT (raw JSON or base64, as on Vercel) or
// GOOGLE_APPLICATION_CREDENTIALS (path to a key file). Neon: DATABASE_URL_UNPOOLED.
// These collections are small (hundreds to a few thousand documents), one read pass each.
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const envFile = join(root, '.env');
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"(.*)"$/, '$1');
  }
}
const dryRun = process.argv.includes('--dry-run');
const url = process.env.DATABASE_URL_UNPOOLED;
if (!url) { console.error('DATABASE_URL_UNPOOLED is not set.'); process.exit(1); }

const { cert, applicationDefault, initializeApp } = await import('firebase-admin/app');
const { getFirestore, Timestamp } = await import('firebase-admin/firestore');
const raw = (process.env.FIREBASE_SERVICE_ACCOUNT ?? '').trim();
let credential, projectId;
if (raw) {
  const sa = JSON.parse(raw.startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8'));
  if (typeof sa.private_key === 'string') sa.private_key = sa.private_key.replace(/\\n/g, '\n');
  credential = cert(sa); projectId = sa.project_id;
} else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  credential = applicationDefault();
} else {
  console.error('Set FIREBASE_SERVICE_ACCOUNT (or GOOGLE_APPLICATION_CREDENTIALS) to read Firestore.');
  process.exit(1);
}
const fs = getFirestore(initializeApp({ credential, projectId }));

const iso = (t) => (t instanceof Timestamp ? t.toDate().toISOString() : null);
const read = async (name) => (await fs.collection(name).get()).docs.map((d) => ({ id: d.id, ...d.data() }));

const [affiliates, clicks, subscribers, admins, redemptions, profiles] = await Promise.all([
  read('affiliates'), read('clicks'), read('newsletter'), read('admins'), read('coupon_redemptions'), read('profiles'),
]);
console.log(`Firestore: affiliates ${affiliates.length} · clicks ${clicks.length} · newsletter ${subscribers.length} · admins ${admins.length} · coupon redemptions ${redemptions.length} · profiles ${profiles.length}`);

// A click with no timestamp can't be placed in time; it is kept but flagged by the epoch.
const EPOCH = '1970-01-01T00:00:00Z';
const rows = {
  affiliates: affiliates.map((a) => [a.slug || a.id, a.label ?? null, iso(a.createdAt) ?? EPOCH]),
  clicks: clicks.filter((c) => c.affiliateId).map((c) => [c.clickId || c.id, String(c.affiliateId), c.landingPath ?? null, iso(c.createdAt) ?? EPOCH]),
  subscribers: subscribers.map((s) => [String(s.email || s.id).toLowerCase(), iso(s.createdAt), s.source ?? null, s.market ?? null, s.status ?? null, typeof s.shopifyOk === 'boolean' ? s.shopifyOk : null]),
};
rows.admins = admins
  .filter((a) => a.role === 'full' || a.role === 'affiliate')
  .map((a) => [String(a.email || a.id).toLowerCase(), a.role, a.label ?? null, a.addedBy ?? null, iso(a.addedAt) ?? EPOCH]);
rows.redemptions = redemptions
  .filter((r) => r.code && r.orderName)
  .map((r) => [String(r.code).toUpperCase(), String(r.orderName), r.orderId ?? null, r.email ?? null, r.phone ?? null, Number(r.amount) || 0, r.at || EPOCH]);
rows.profiles = profiles.map((p) => [p.id, p.email ?? null, p.full_name ?? null, p.phone ?? null, p.address1 ?? null, p.address2 ?? null, p.city ?? null, p.province ?? null, p.zip ?? null, iso(p.updated_at) ?? EPOCH]);
const skipped = clicks.length - rows.clicks.length;
if (skipped) console.log(`Skipped ${skipped} click(s) with no affiliate.`);

if (dryRun) { console.log('Dry run: nothing written.'); process.exit(0); }

const db = new pg.Client({ connectionString: url });
await db.connect();
try {
  await db.query('BEGIN');
  const count = async (t) => Number((await db.query(`SELECT count(*) FROM ${t}`)).rows[0].count);
  const before = { affiliates: await count('affiliates'), affiliate_clicks: await count('affiliate_clicks'), newsletter_signups: await count('newsletter_signups'), admins: await count('admins'), coupon_redemptions: await count('coupon_redemptions'), customer_profiles: await count('customer_profiles') };
  const batch = async (sql, list, width) => {
    for (let i = 0; i < list.length; i += 500) {
      const part = list.slice(i, i + 500);
      const ph = part.map((_, r) => '(' + Array.from({ length: width }, (_, c) => `$${r * width + c + 1}`).join(',') + ')').join(',');
      await db.query(sql.replace('%VALUES%', ph), part.flat());
    }
  };
  await batch(`INSERT INTO affiliates (slug, label, created_at) VALUES %VALUES% ON CONFLICT (slug) DO NOTHING`, rows.affiliates, 3);
  await batch(`INSERT INTO affiliate_clicks (click_id, affiliate, landing_path, created_at) VALUES %VALUES% ON CONFLICT (click_id) DO NOTHING`, rows.clicks, 4);
  await batch(`INSERT INTO newsletter_signups (email, created_at, source, market, status, shopify_ok) VALUES %VALUES% ON CONFLICT (email) DO NOTHING`, rows.subscribers, 6);
  await batch(`INSERT INTO admins (email, role, label, added_by, added_at) VALUES %VALUES% ON CONFLICT (email) DO NOTHING`, rows.admins, 5);
  await batch(`INSERT INTO coupon_redemptions (code, order_name, order_id, email, phone, amount, at) VALUES %VALUES% ON CONFLICT (code, order_name) DO NOTHING`, rows.redemptions, 7);
  await batch(`INSERT INTO customer_profiles (uid, email, full_name, phone, address1, address2, city, province, zip, updated_at) VALUES %VALUES% ON CONFLICT (uid) DO NOTHING`, rows.profiles, 10);
  const after = { affiliates: await count('affiliates'), affiliate_clicks: await count('affiliate_clicks'), newsletter_signups: await count('newsletter_signups'), admins: await count('admins'), coupon_redemptions: await count('coupon_redemptions'), customer_profiles: await count('customer_profiles') };
  await db.query('COMMIT');
  console.log('\nNeon rows          before   after   added');
  for (const k of Object.keys(after)) console.log(`  ${k.padEnd(18)} ${String(before[k]).padStart(5)}  ${String(after[k]).padStart(6)}  ${String(after[k] - before[k]).padStart(6)}`);
} catch (e) {
  await db.query('ROLLBACK');
  throw e;
} finally {
  await db.end();
}
