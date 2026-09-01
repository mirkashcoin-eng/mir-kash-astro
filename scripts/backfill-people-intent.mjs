// One-time: stamp `intent: true` + `intentAt` on every existing `people` doc that
// reached cart / phone / address, so getPeople's `where('intent','==',true)` query
// picks up leads that predate the flag. New leads get it live (see linkPerson in
// src/lib/leads.ts). Safe to re-run — it only writes docs still missing the flag.
//
//   node scripts/backfill-people-intent.mjs --key ~/Downloads/<service-account>.json [--dry]
//   (or FIREBASE_SERVICE_ACCOUNT in the env, or GOOGLE_APPLICATION_CREDENTIALS)
import { readFileSync } from 'node:fs';
import { cert, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const DRY = process.argv.includes('--dry');

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
    console.error('No credentials. Pass --key <path-to-service-account.json> or set FIREBASE_SERVICE_ACCOUNT.');
    process.exit(1);
  }
  const jsonStr = raw.startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8');
  const sa = JSON.parse(jsonStr);
  if (typeof sa.private_key === 'string') sa.private_key = sa.private_key.replace(/\\n/g, '\n');
  return sa;
}

const sa = serviceAccount();
initializeApp({ credential: cert(sa), projectId: sa.project_id });
const db = getFirestore();

// Earliest of the intent timestamps we have, as the Timestamp to store for intentAt.
function earliest(...ts) {
  const real = ts.filter((t) => t && typeof t.toMillis === 'function');
  if (!real.length) return null;
  return real.reduce((a, b) => (a.toMillis() <= b.toMillis() ? a : b));
}

let scanned = 0, toWrite = 0, already = 0;
let cursor = null;
let batch = db.batch();
let ops = 0;

async function flush() {
  if (ops && !DRY) { await batch.commit(); batch = db.batch(); ops = 0; }
}

for (;;) {
  let q = db.collection('people').orderBy('__name__').limit(1000);
  if (cursor) q = q.startAfter(cursor);
  const snap = await q.get();
  if (snap.empty) break;
  for (const doc of snap.docs) {
    scanned++;
    const p = doc.data() || {};
    const hasIntent = p.cartAt || p.phoneAt || p.addressAt;
    if (!hasIntent) continue;
    if (p.intent === true) { already++; continue; }
    toWrite++;
    const at = earliest(p.cartAt, p.phoneAt, p.addressAt);
    const patch = { intent: true };
    if (at) patch.intentAt = at;
    if (DRY) {
      console.log(`would flag ${doc.id}  ${p.name || p.phone || '(anon)'}  ${p.addressAt ? 'address' : p.phoneAt ? 'phone' : 'cart'}`);
    } else {
      batch.set(doc.ref, patch, { merge: true });
      if (++ops === 400) await flush();
    }
  }
  cursor = snap.docs[snap.docs.length - 1];
  if (snap.size < 1000) break;
}
await flush();

console.log(`\nScanned ${scanned} people · ${already} already flagged · ${toWrite} ${DRY ? 'to flag (dry run — nothing written)' : 'newly flagged'}.`);
process.exit(0);
