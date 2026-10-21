// One-time copy of the old Firestore analytics history into Neon.
// Run: node scripts/migrate-firestore.mjs [--dry-run] [--limit N] [--from-json file]
//
//   --dry-run         read + map, print what would be written; writes nothing to Neon.
//   --limit N         read at most N docs per collection (a quick trial).
//   --from-json file  read the docs from a JSON file shaped { leads: { id: data }, people,
//                     funnel_daily, analytics_daily, product_stats } instead of Firestore —
//                     for rehearsing on a Neon branch without spending Firestore quota.
//
// Firestore is READ-ONLY here: the script never writes, updates or deletes a doc. Each
// collection is read exactly once, in pages, so a run costs one read per doc (the
// quota has run out before — don't loop it). Credentials: FIREBASE_SERVICE_ACCOUNT
// (raw JSON or base64, as on Vercel) or GOOGLE_APPLICATION_CREDENTIALS (a key file path).
//
// Idempotent: event ids are deterministic (see scripts/lib/firestore-map.mjs) and every
// insert is ON CONFLICT-guarded, so running it again adds nothing. Rows the live
// tracker already wrote win: a person's existing phone/email/name/address are kept,
// only first/last seen widen. Everything runs in one transaction on the DIRECT
// connection (DATABASE_URL_UNPOOLED) — a failure leaves Neon untouched.
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { plan } from './lib/firestore-map.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// Load .env without a dependency; real env vars win.
const envFile = join(root, '.env');
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"(.*)"$/, '$1');
  }
}

const args = process.argv.slice(2);
const flag = (k) => args.includes(k);
const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
const dryRun = flag('--dry-run');
const limit = opt('--limit') ? Number(opt('--limit')) : Infinity;
const fromJson = opt('--from-json');
if (!(limit > 0)) { console.error('--limit must be a positive number.'); process.exit(1); }

const COLLECTIONS = ['leads', 'people', 'funnel_daily', 'analytics_daily', 'product_stats'];

// ── Read ──────────────────────────────────────────────────────────────────────

// Firestore Timestamps → Date, recursively, so the mapper sees plain data.
function plain(v, Timestamp) {
  if (v instanceof Timestamp) return v.toDate();
  if (Array.isArray(v)) return v.map((x) => plain(x, Timestamp));
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, plain(x, Timestamp)]));
  return v;
}

async function readFirestore() {
  const { cert, applicationDefault, initializeApp } = await import('firebase-admin/app');
  const { getFirestore, FieldPath, Timestamp } = await import('firebase-admin/firestore');
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
  const db = getFirestore(initializeApp({ credential, projectId }));
  const out = {};
  for (const c of COLLECTIONS) {
    out[c] = {};
    let last = null, n = 0;
    // Page by document id: one pass, one read per doc, no offset re-reads.
    while (n < limit) {
      let q = db.collection(c).orderBy(FieldPath.documentId()).limit(Math.min(500, limit - n));
      if (last) q = q.startAfter(last);
      const snap = await q.get();
      if (snap.empty) break;
      for (const d of snap.docs) out[c][d.id] = plain(d.data(), Timestamp);
      n += snap.size;
      last = snap.docs[snap.docs.length - 1].id;
      process.stdout.write(`\rReading ${c} … ${n}`);
      if (snap.size < 500) break;
    }
    process.stdout.write(`\rReading ${c} … ${n}\n`);
  }
  return out;
}

function readJson(file) {
  const j = JSON.parse(readFileSync(file, 'utf8'));
  const out = {};
  for (const c of COLLECTIONS) out[c] = Object.fromEntries(Object.entries(j[c] ?? {}).slice(0, limit));
  return out;
}

// ── Write ─────────────────────────────────────────────────────────────────────

// Column lists + conflict rule per table. `RETURNING (xmax = 0)` is true for a row
// this statement inserted (false for one it updated), which is how the summary tells
// new rows from ones already there.
const TABLES = {
  people: {
    cols: ['person_id', 'phone', 'email', 'name', 'address1', 'city', 'province', 'pin', 'first_seen', 'last_seen', 'is_test'],
    cast: { first_seen: 'COALESCE($::timestamptz, now())', last_seen: 'COALESCE($::timestamptz, now())' },
    conflict: `ON CONFLICT (person_id) DO UPDATE SET
      first_seen = LEAST(people.first_seen, EXCLUDED.first_seen),
      last_seen = GREATEST(people.last_seen, EXCLUDED.last_seen),
      phone = COALESCE(people.phone, EXCLUDED.phone), email = COALESCE(people.email, EXCLUDED.email),
      name = COALESCE(people.name, EXCLUDED.name), address1 = COALESCE(people.address1, EXCLUDED.address1),
      city = COALESCE(people.city, EXCLUDED.city), province = COALESCE(people.province, EXCLUDED.province),
      pin = COALESCE(people.pin, EXCLUDED.pin), is_test = people.is_test OR EXCLUDED.is_test`,
  },
  visitors: {
    cols: ['visitor_id', 'person_id', 'first_seen', 'last_seen', 'is_bot', 'bot_name', 'is_test'],
    conflict: `ON CONFLICT (visitor_id) DO UPDATE SET
      person_id = COALESCE(visitors.person_id, EXCLUDED.person_id),
      first_seen = LEAST(visitors.first_seen, EXCLUDED.first_seen),
      last_seen = GREATEST(visitors.last_seen, EXCLUDED.last_seen),
      is_bot = visitors.is_bot OR EXCLUDED.is_bot, bot_name = COALESCE(visitors.bot_name, EXCLUDED.bot_name),
      is_test = visitors.is_test OR EXCLUDED.is_test`,
  },
  // A session's attribution is written once; a re-run leaves it alone.
  sessions: {
    cols: ['session_id', 'visitor_id', 'started_at', 'last_at', 'landing', 'referrer', 'source', 'medium', 'campaign', 'country', 'market', 'is_bot'],
    conflict: 'ON CONFLICT (session_id) DO NOTHING',
  },
  events: {
    cols: ['event_id', 'ts', 'visitor_id', 'session_id', 'name', 'page', 'product', 'value', 'currency', 'props', 'is_bot', 'migrated'],
    cast: { props: '$::jsonb' },
    conflict: 'ON CONFLICT (event_id) DO NOTHING',
  },
  // The Firestore counter is the truth for its day; a re-run refreshes it.
  legacy_daily: {
    cols: ['day', 'source', 'metric', 'value'],
    conflict: 'ON CONFLICT (day, source, metric) DO UPDATE SET value = EXCLUDED.value',
  },
};

// Multi-row INSERTs, sized to stay well under Postgres's 65,535-parameter limit.
async function insertAll(client, table, rows) {
  const { cols, cast = {}, conflict } = TABLES[table];
  const per = Math.min(1000, Math.floor(30000 / cols.length));
  let inserted = 0;
  for (let i = 0; i < rows.length; i += per) {
    const chunk = rows.slice(i, i + per);
    const vals = [];
    const tuples = chunk.map((r) => '(' + cols.map((c) => {
      vals.push(c === 'props' ? JSON.stringify(r[c] ?? {}) : c === 'migrated' ? true : r[c] ?? null);
      return (cast[c] ?? '$').replace('$', () => `$${vals.length}`);
    }).join(',') + ')');
    const res = await client.query(
      `INSERT INTO ${table} (${cols.join(',')}) VALUES ${tuples.join(',')} ${conflict} RETURNING (xmax = 0) AS ins`,
      vals,
    );
    inserted += res.rows.filter((r) => r.ins).length;
  }
  return inserted;
}

// ── Run ───────────────────────────────────────────────────────────────────────

const url = process.env.DATABASE_URL_UNPOOLED || (dryRun ? process.env.DATABASE_URL : '');
if (!url && !dryRun) { console.error('DATABASE_URL_UNPOOLED is not set (run `neon env pull`).'); process.exit(1); }
const client = url ? new pg.Client({ connectionString: url }) : null;
if (client) {
  await client.connect();
  const { rows: [db] } = await client.query('SELECT current_database() AS name');
  console.log(`Neon: ${new URL(url).hostname} / ${db.name}${process.env.NEON_BRANCH ? ` (branch ${process.env.NEON_BRANCH})` : ''}${dryRun ? ' — dry run, read-only' : ''}`);
}

try {
  // Test numbers come from Neon's test_people, so is_test matches the live collector.
  const testIds = new Set(client ? (await client.query('SELECT person_id FROM test_people')).rows.map((r) => r.person_id) : []);
  if (!client) console.warn('Warning: no database URL — test_people not read, nobody is marked is_test.');

  const docs = fromJson ? readJson(fromJson) : await readFirestore();
  const p = plan(docs, testIds);
  const out = { people: p.people, visitors: p.visitors, sessions: p.sessions, events: p.events, legacy_daily: p.legacy };

  const written = {};
  if (!dryRun) {
    await client.query('BEGIN');
    try {
      // FK order: people ← visitors ← sessions.
      for (const t of Object.keys(out)) written[t] = await insertAll(client, t, out[t]);
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    }
  }

  // ── Summary ──
  const pad = (s, n) => String(s).padEnd(n);
  const lpad = (s, n) => String(s).padStart(n);
  console.log(`\nFirestore docs read${fromJson ? ` (from ${fromJson})` : ''}`);
  for (const c of COLLECTIONS) console.log(`  ${pad(c, 18)}${lpad(Object.keys(docs[c]).length, 8)}`);
  console.log(`\nNeon rows${dryRun ? ' (dry run — nothing written)' : ''}`);
  console.log(`  ${pad('table', 18)}${lpad('mapped', 8)}${dryRun ? '' : lpad('new', 8) + lpad('existed', 9)}`);
  for (const [t, rows] of Object.entries(out)) {
    console.log(`  ${pad(t, 18)}${lpad(rows.length, 8)}${dryRun ? '' : lpad(written[t], 8) + lpad(rows.length - written[t], 9)}`);
  }
  const byName = {};
  for (const e of p.events) byName[e.name] = (byName[e.name] || 0) + 1;
  console.log(`  events by name: ${Object.entries(byName).map(([k, v]) => `${k} ${v}`).join(', ') || '—'}`);
  const list = (title, t) => {
    const e = Object.entries(t);
    console.log(`\n${title}${e.length ? '' : ': none'}`);
    for (const [k, v] of e.sort()) console.log(`  ${pad(k, 62)}${lpad(v, 7)}`);
  };
  list('Skipped', p.skipped);
  list('Kept, with a caveat', p.notes);
} finally {
  await client?.end();
}
