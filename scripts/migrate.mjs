// Applies db/migrations/*.sql to Neon, in filename order, each exactly once.
// Run: npm run db:migrate
//
// Uses the DIRECT connection (DATABASE_URL_UNPOOLED) — schema changes must not go
// through the pooler. Each file runs in its own transaction and is recorded in
// schema_migrations, so a re-run only applies new files and a failed file leaves
// nothing half-applied.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// Load .env without a dependency; real env vars win.
const envFile = join(root, '.env');
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"(.*)"$/, '$1');
  }
}

const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!url) { console.error('DATABASE_URL_UNPOOLED is not set (run `neon env pull`).'); process.exit(1); }
if (!process.env.DATABASE_URL_UNPOOLED) console.warn('Warning: DATABASE_URL_UNPOOLED missing — using the pooled URL.');

const dir = join(root, 'db', 'migrations');
const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();

const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
  const done = new Set((await client.query('SELECT name FROM schema_migrations')).rows.map((r) => r.name));
  let applied = 0;
  for (const f of files) {
    if (done.has(f)) continue;
    const sql = readFileSync(join(dir, f), 'utf8');
    process.stdout.write(`Applying ${f} … `);
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [f]);
      await client.query('COMMIT');
      console.log('ok');
      applied++;
    } catch (e) {
      await client.query('ROLLBACK');
      console.log('FAILED');
      throw e;
    }
  }
  console.log(applied ? `${applied} migration(s) applied.` : 'Up to date.');
} finally {
  await client.end();
}
