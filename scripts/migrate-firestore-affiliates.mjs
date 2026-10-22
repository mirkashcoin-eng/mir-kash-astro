// One-time copy of the affiliate links, their clicks and the newsletter list from
// Firestore into Neon (tables from db/migrations/005_affiliates.sql). Read-only on
// Firestore, idempotent on Neon: a re-run adds what is missing and changes nothing else.
// Run: node scripts/migrate-firestore-affiliates.mjs [--dry-run]
//
// Firestore credentials: FIREBASE_SERVICE_ACCOUNT (raw JSON or base64, as on Vercel) or
// GOOGLE_APPLICATION_CREDENTIALS (path to a key file). Neon: DATABASE_URL_UNPOOLED.
// These three collections are small (hundreds of documents), so this costs a few hundred
// Firestore reads, one pass each.
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

const [affiliates, clicks, subscribers] = await Promise.all([read('affiliates'), read('clicks'), read('newsletter')]);
console.log(`Firestore: affiliates ${affiliates.length} · clicks ${clicks.length} · newsletter ${subscribers.length}`);

// A click with no timestamp can't be placed in time; it is kept but flagged by the epoch.
const EPOCH = '1970-01-01T00:00:00Z';
const rows = {
  affiliates: affiliates.map((a) => [a.slug || a.id, a.label ?? null, iso(a.createdAt) ?? EPOCH]),
  clicks: clicks.filter((c) => c.affiliateId).map((c) => [c.clickId || c.id, String(c.affiliateId), c.landingPath ?? null, iso(c.createdAt) ?? EPOCH]),
  subscribers: subscribers.map((s) => [String(s.email || s.id).toLowerCase(), iso(s.createdAt), s.source ?? null, s.market ?? null, s.status ?? null, typeof s.shopifyOk === 'boolean' ? s.shopifyOk : null]),
};
const skipped = clicks.length - rows.clicks.length;
if (skipped) console.log(`Skipped ${skipped} click(s) with no affiliate.`);

if (dryRun) { console.log('Dry run: nothing written.'); process.exit(0); }

const db = new pg.Client({ connectionString: url });
await db.connect();
try {
  await db.query('BEGIN');
  const count = async (t) => Number((await db.query(`SELECT count(*) FROM ${t}`)).rows[0].count);
  const before = { affiliates: await count('affiliates'), affiliate_clicks: await count('affiliate_clicks'), newsletter_signups: await count('newsletter_signups') };
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
  const after = { affiliates: await count('affiliates'), affiliate_clicks: await count('affiliate_clicks'), newsletter_signups: await count('newsletter_signups') };
  await db.query('COMMIT');
  console.log('\nNeon rows          before   after   added');
  for (const k of Object.keys(after)) console.log(`  ${k.padEnd(18)} ${String(before[k]).padStart(5)}  ${String(after[k]).padStart(6)}  ${String(after[k] - before[k]).padStart(6)}`);
} catch (e) {
  await db.query('ROLLBACK');
  throw e;
} finally {
  await db.end();
}
