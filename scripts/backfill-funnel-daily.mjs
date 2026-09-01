// Rebuilds the `funnel_daily` collection from the full `people` collection.
//
// funnel_daily holds immutable per-IST-day funnel counts that /admin's Daily funnel
// grid reads directly. The grid used to be computed live from getPeople(500) — a
// capped, re-sortable list — so old columns shrank as visitors scrolled out of the
// window. This script reconstructs the true history once; from then on the app
// keeps the counts current as each person first reaches each step.
//
// Safe to re-run: every day-doc is recomputed from scratch and overwritten. Re-run
// after a while if you want the small live-path drift (see NOTE below) cleaned up.
//
// Credentials — any one of these:
//   1. A key file downloaded from Firebase Console → Project settings →
//      Service accounts → "Generate new private key":
//        node scripts/backfill-funnel-daily.mjs --key ~/Downloads/mirkash-xxxx.json
//      (or set GOOGLE_APPLICATION_CREDENTIALS to that path)
//   2. FIREBASE_SERVICE_ACCOUNT in the env (raw JSON or base64), same as Vercel:
//        node --env-file=.env scripts/backfill-funnel-daily.mjs
//
// Add --dry to preview the per-day counts without writing anything.
// The key file is a secret — keep it outside the repo and delete it when done.
//
// NOTE on accuracy: we only store `firstSeen` and `viewedAt` (last product view),
// not a timestamp per product. So p1 (1st product view) is attributed to the
// first-seen day and p2/p3 to the last-view day — an approximation for people who
// browsed across several days. Everything else (visitors, cart, phone, address)
// is exact.
import { readFileSync } from 'node:fs';
import { cert, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const DRY = process.argv.includes('--dry');
const HIDDEN = new Set(['7738784781', '8306883773']); // keep in sync with HIDDEN_PERSON_KEYS in src/lib/funnel.ts

function keyFilePath() {
  const i = process.argv.indexOf('--key');
  if (i > -1 && process.argv[i + 1]) return process.argv[i + 1];
  return process.env.GOOGLE_APPLICATION_CREDENTIALS || '';
}

function serviceAccount() {
  const path = keyFilePath();
  let raw = '';
  if (path) {
    try { raw = readFileSync(path.replace(/^~/, process.env.HOME || '~'), 'utf8').trim(); }
    catch (e) { console.error(`Could not read key file at ${path}: ${e.message}`); process.exit(1); }
  } else {
    raw = (process.env.FIREBASE_SERVICE_ACCOUNT || '').trim();
  }
  if (!raw) {
    console.error('No credentials. Pass --key <path-to-service-account.json> (download it from');
    console.error('Firebase Console → Project settings → Service accounts → Generate new private key),');
    console.error('or set FIREBASE_SERVICE_ACCOUNT in the environment.');
    process.exit(1);
  }
  const jsonStr = raw.startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8');
  const sa = JSON.parse(jsonStr);
  if (typeof sa.private_key === 'string') sa.private_key = sa.private_key.replace(/\\n/g, '\n');
  return sa;
}

// The IST calendar day (YYYY-MM-DD) a Firestore Timestamp / date falls on.
function istDay(ts) {
  if (!ts) return '';
  const d = ts && typeof ts.toDate === 'function' ? ts.toDate() : new Date(ts);
  const t = d.getTime();
  if (!isFinite(t) || !t) return '';
  return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
}

const sa = serviceAccount();
initializeApp({ credential: cert(sa), projectId: sa.project_id });
const db = getFirestore();

const days = {}; // { 'YYYY-MM-DD': { visitors: n, p1: n, bot_cart: n, hidden_visitors: n, … } }
const add = (day, field) => {
  if (!day) return;
  (days[day] || (days[day] = {}));
  days[day][field] = (days[day][field] || 0) + 1;
};

let scanned = 0;
let cursor = null;
for (;;) {
  let q = db.collection('people').orderBy('__name__').limit(1000);
  if (cursor) q = q.startAfter(cursor);
  const snap = await q.get();
  if (snap.empty) break;
  snap.forEach((doc) => {
    scanned++;
    const p = doc.data() || {};
    const pfx = HIDDEN.has(doc.id) ? 'hidden_' : (p.bot ? 'bot_' : '');
    const first = istDay(p.firstSeen);
    const lastView = istDay(p.viewedAt) || first;
    if (first) add(first, pfx + 'visitors');
    const nv = Array.isArray(p.viewed) ? p.viewed.length : 0;
    if (nv >= 1) add(first, pfx + 'p1');
    if (nv >= 2) add(lastView, pfx + 'p2');
    if (nv >= 3) add(lastView, pfx + 'p3');
    if (p.cartAt) add(istDay(p.cartAt), pfx + 'cart');
    if (p.phoneAt) add(istDay(p.phoneAt), pfx + 'phone');
    if (p.addressAt) add(istDay(p.addressAt), pfx + 'address');
  });
  cursor = snap.docs[snap.docs.length - 1];
  if (snap.size < 1000) break;
}

const dayKeys = Object.keys(days).sort();
console.log(`Scanned ${scanned} people → ${dayKeys.length} day buckets (${dayKeys[0] || '—'} … ${dayKeys[dayKeys.length - 1] || '—'}).`);

if (DRY) {
  for (const k of dayKeys) console.log(k, JSON.stringify(days[k]));
  console.log('\nDry run — nothing written.');
  process.exit(0);
}

let batch = db.batch();
let ops = 0;
let written = 0;
for (const k of dayKeys) {
  batch.set(db.collection('funnel_daily').doc(k), { day: k, ...days[k] }); // full overwrite
  written++;
  if (++ops === 400) { await batch.commit(); batch = db.batch(); ops = 0; }
}
if (ops) await batch.commit();
console.log(`Wrote ${written} funnel_daily docs.`);
process.exit(0);
