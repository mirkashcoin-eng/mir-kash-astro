// GA4 Data API — the only source for age, gender and interests (our own event log
// can't know them). Plain fetch against analyticsdata.googleapis.com, authenticated
// as a Google service account: we sign a JWT with `jose`, swap it for an access
// token at oauth2.googleapis.com (scope analytics.readonly) and cache the token.
//
// Env:
//   GA4_PROPERTY_ID      the numeric property id (Admin → Property details), NOT the
//                        G-… measurement id. "properties/123" is accepted too.
//   GA4_SERVICE_ACCOUNT  service-account JSON (raw or base64). Optional: falls back to
//                        FIREBASE_SERVICE_ACCOUNT — the same Google Cloud service
//                        account just needs Viewer access on the GA property.
// Degrades to null when unconfigured and never throws — analytics must never take
// the shop down. See docs/ga4-setup.md for the founder's setup steps.
//
// Everything above the "Network" line is pure (no I/O, no `~/` imports), so
// ga4.test.mjs can import this file directly under node.
import { SignJWT, importPKCS8 } from 'jose';

// One GA report per dimension. `key` is what lands in ga_audience_daily.dimension.
export const GA_DIMENSIONS = [
  { key: 'age', api: 'userAgeBracket' },
  { key: 'gender', api: 'userGender' },
  { key: 'interest', api: 'brandingInterest' },
  { key: 'device', api: 'deviceCategory' },
  { key: 'os', api: 'operatingSystem' },
  { key: 'browser', api: 'browser' },
  { key: 'city', api: 'city' },
  { key: 'country', api: 'country' },
  { key: 'channel', api: 'sessionDefaultChannelGroup' },
  { key: 'new_vs_returning', api: 'newVsReturning' },
] as const;

// Metric sets, tried in order. `keyEvents` replaced `conversions` in 2024; older
// properties or some dimension combinations may reject one or the other, and the
// last resort drops conversions entirely rather than failing the whole dimension.
export const METRIC_SETS: string[][] = [
  ['activeUsers', 'sessions', 'keyEvents'],
  ['activeUsers', 'sessions', 'conversions'],
  ['activeUsers', 'sessions'],
];

export interface AudienceRow {
  day: string;            // YYYY-MM-DD (property time zone)
  dimension: string;      // GA_DIMENSIONS[].key
  value: string;          // GA's value, verbatim
  users: number;
  sessions: number;
  conversions: number | null; // null = GA gave no conversions metric (not zero)
}

interface GaReport {
  dimensionHeaders?: { name: string }[];
  metricHeaders?: { name: string }[];
  rows?: { dimensionValues?: { value?: string }[]; metricValues?: { value?: string }[] }[];
  rowCount?: number;
  metadata?: { subjectToThresholding?: boolean; dataLossFromOtherRow?: boolean };
}

const pad = (n: number) => String(n).padStart(2, '0');

// GA's `date` dimension is YYYYMMDD; the table wants YYYY-MM-DD.
export function gaDateToIso(d: string): string | null {
  return /^\d{8}$/.test(d) ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}` : null;
}

// Calendar date of `now` in `tz` (GA reports in the property's time zone; ours is IST).
export function localDate(now: Date, tz = 'Asia/Kolkata'): string {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(now);
  const get = (t: string) => p.find((x) => x.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

export const SETTLE_DAYS = 3;     // GA keeps revising the last ~2 days; re-pull them each run
export const BACKFILL_DAYS = 90;  // first run (empty table)
export const MAX_DAYS = 365;      // manual ?days= cap

// How many days to pull: an explicit override wins (clamped), else 90 for an empty
// table, else the settle window.
export function syncDays(tableEmpty: boolean, override?: number | null): number {
  if (override != null && Number.isFinite(override) && override >= 1) return Math.min(Math.floor(override), MAX_DAYS);
  return tableEmpty ? BACKFILL_DAYS : SETTLE_DAYS;
}

// `days` complete days ending yesterday (in tz). Today is left out — it's partial
// and would be overwritten tomorrow anyway.
export function dateRange(now: Date, days: number, tz = 'Asia/Kolkata'): { startDate: string; endDate: string } {
  const endDate = addDays(localDate(now, tz), -1);
  return { startDate: addDays(endDate, -(Math.max(1, days) - 1)), endDate };
}

// One report (dimensions [date, <api>]) → table rows.
// GA thresholding: groups too small to be anonymous are withheld or folded into
// `(other)`; unknown values come back as `(not set)` / `unknown`. Those rows are
// stored exactly as GA sends them, and withheld groups simply have no row — we never
// invent a zero for a value GA didn't report. Rows with an unreadable date or
// metric are dropped rather than guessed.
export function reportToRows(dimensionKey: string, report: GaReport): AudienceRow[] {
  const dims = (report.dimensionHeaders ?? []).map((h) => h.name);
  const mets = (report.metricHeaders ?? []).map((h) => h.name);
  const di = dims.indexOf('date');
  const vi = dims.findIndex((n) => n !== 'date');
  const ui = mets.indexOf('activeUsers');
  const si = mets.indexOf('sessions');
  const ci = mets.indexOf('keyEvents') >= 0 ? mets.indexOf('keyEvents') : mets.indexOf('conversions');
  if (di < 0 || vi < 0 || ui < 0 || si < 0) return [];

  const num = (v: string | undefined): number | null => {
    if (v == null || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? Math.round(n) : null; // keyEvents can be fractional-typed
  };

  const out: AudienceRow[] = [];
  for (const r of report.rows ?? []) {
    const dv = r.dimensionValues ?? [];
    const mv = r.metricValues ?? [];
    const day = gaDateToIso(dv[di]?.value ?? '');
    const value = dv[vi]?.value;
    const users = num(mv[ui]?.value);
    const sessions = num(mv[si]?.value);
    const conversions = ci >= 0 ? num(mv[ci]?.value) : null;
    if (!day || value == null || users == null || sessions == null) continue;
    out.push({ day, dimension: dimensionKey, value, users, sessions, conversions });
  }
  return mergeRows(out);
}

// Same (day, dimension, value) twice is possible — GA's `city` is a name, so two
// cities called "Hyderabad" (India, Pakistan) arrive as two rows, possibly on
// different pages. Sum them: that's the table's primary key, and one INSERT can't
// touch the same key twice.
export function mergeRows(rows: AudienceRow[]): AudienceRow[] {
  const byKey = new Map<string, AudienceRow>();
  for (const r of rows) {
    const k = `${r.day}\u0000${r.dimension}\u0000${r.value}`;
    const prev = byKey.get(k);
    if (!prev) { byKey.set(k, { ...r }); continue; }
    prev.users += r.users;
    prev.sessions += r.sessions;
    prev.conversions = prev.conversions == null || r.conversions == null ? null : prev.conversions + r.conversions;
  }
  return [...byKey.values()];
}

// A 400 INVALID_ARGUMENT means GA rejected a field (unknown/incompatible metric or
// dimension) — worth retrying with a smaller metric set. Anything else (auth,
// quota, 5xx) won't be fixed by changing metrics.
export function isFieldRejection(status: number, body: string): boolean {
  return status === 400 && /INVALID_ARGUMENT|not a valid|incompatible|Did you mean/i.test(body);
}

export function parseServiceAccount(raw: string): { client_email: string; private_key: string; private_key_id?: string } | null {
  const s = raw.trim();
  if (!s) return null;
  try {
    // Raw JSON or a base64 blob, like FIREBASE_SERVICE_ACCOUNT.
    const sa = JSON.parse(s.startsWith('{') ? s : Buffer.from(s, 'base64').toString('utf8'));
    if (typeof sa?.client_email !== 'string' || typeof sa?.private_key !== 'string') return null;
    // Vercel may store the escaped \n; normalise to real newlines for the PEM key.
    return { client_email: sa.client_email, private_key: sa.private_key.replace(/\\n/g, '\n'), private_key_id: sa.private_key_id };
  } catch {
    return null;
  }
}

export function normalizePropertyId(raw: string): string | null {
  const m = raw.trim().match(/^(?:properties\/)?(\d+)$/);
  return m ? m[1] : null;
}

// ---- Network ----------------------------------------------------------------

function env(k: string): string {
  if (typeof process !== 'undefined' && process.env && process.env[k]) return process.env[k] as string;
  const m = (import.meta as { env?: Record<string, string | undefined> }).env;
  return m?.[k] ?? '';
}

interface Ga4Config { propertyId: string; sa: NonNullable<ReturnType<typeof parseServiceAccount>>; saSource: string }

let _cfg: Ga4Config | null | undefined;

export function ga4Config(): Ga4Config | null {
  if (_cfg !== undefined) return _cfg;
  const propertyId = normalizePropertyId(env('GA4_PROPERTY_ID'));
  const own = env('GA4_SERVICE_ACCOUNT');
  const sa = parseServiceAccount(own || env('FIREBASE_SERVICE_ACCOUNT'));
  if (!propertyId || !sa) {
    _cfg = null;
    if (env('GA4_PROPERTY_ID') && !propertyId) console.error('[ga4] GA4_PROPERTY_ID is not a numeric property id');
    return null;
  }
  _cfg = { propertyId, sa, saSource: own ? 'GA4_SERVICE_ACCOUNT' : 'FIREBASE_SERVICE_ACCOUNT' };
  return _cfg;
}

let _token: { value: string; exp: number } | null = null;

async function accessToken(cfg: Ga4Config): Promise<string | null> {
  if (_token && _token.exp > Date.now() + 60_000) return _token.value;
  try {
    const key = await importPKCS8(cfg.sa.private_key, 'RS256');
    const assertion = await new SignJWT({ scope: 'https://www.googleapis.com/auth/analytics.readonly' })
      .setProtectedHeader({ alg: 'RS256', typ: 'JWT', ...(cfg.sa.private_key_id ? { kid: cfg.sa.private_key_id } : {}) })
      .setIssuer(cfg.sa.client_email)
      .setAudience('https://oauth2.googleapis.com/token')
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(key);
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
    });
    const j = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error?: string };
    if (!res.ok || !j.access_token) {
      console.error('[ga4] token exchange failed:', res.status, j.error ?? '');
      return null;
    }
    _token = { value: j.access_token, exp: Date.now() + (j.expires_in ?? 3600) * 1000 };
    return _token.value;
  } catch (e) {
    console.error('[ga4] token signing failed:', e);
    return null;
  }
}

type RunReport = { ok: true; report: GaReport } | { ok: false; status: number; error: string };

const PAGE = 100_000; // GA allows up to 250k rows per request

// One runReport call. Never throws.
async function runReport(cfg: Ga4Config, body: Record<string, unknown>): Promise<RunReport> {
  const token = await accessToken(cfg);
  if (!token) return { ok: false, status: 0, error: 'no access token (check the service account key)' };
  try {
    const res = await fetch(`https://analyticsdata.googleapis.com/v1beta/properties/${cfg.propertyId}:runReport`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) return { ok: false, status: res.status, error: text.slice(0, 500) };
    return { ok: true, report: JSON.parse(text) as GaReport };
  } catch (e) {
    return { ok: false, status: 0, error: String(e) };
  }
}

export type AudienceFetch =
  | { ok: true; rows: AudienceRow[]; metrics: string[]; thresholded: boolean; otherRow: boolean }
  | { ok: false; error: string };

// All days in [startDate, endDate] for one dimension, paginated, with the metric
// fallback. Returns null only when GA isn't configured.
export async function fetchAudience(
  dim: (typeof GA_DIMENSIONS)[number],
  range: { startDate: string; endDate: string },
): Promise<AudienceFetch | null> {
  const cfg = ga4Config();
  if (!cfg) return null;

  let lastError = '';
  for (const metrics of METRIC_SETS) {
    const rows: AudienceRow[] = [];
    let thresholded = false;
    let otherRow = false;
    let offset = 0;
    let rejected = false;
    let failed = false;
    for (let page = 0; page < 20; page++) {
      const r = await runReport(cfg, {
        dateRanges: [range],
        dimensions: [{ name: 'date' }, { name: dim.api }],
        metrics: metrics.map((name) => ({ name })),
        limit: PAGE,
        offset,
      });
      if (!r.ok) {
        lastError = `${r.status} ${r.error}`;
        if (isFieldRejection(r.status, r.error)) rejected = true;
        else failed = true;
        break;
      }
      rows.push(...reportToRows(dim.key, r.report));
      thresholded ||= !!r.report.metadata?.subjectToThresholding;
      otherRow ||= !!r.report.metadata?.dataLossFromOtherRow;
      offset += r.report.rows?.length ?? 0;
      if (!r.report.rows?.length || offset >= (r.report.rowCount ?? 0)) {
        return { ok: true, rows: mergeRows(rows), metrics, thresholded, otherRow };
      }
    }
    if (failed) break;     // auth / quota / network — another metric set won't help
    if (!rejected) { lastError = 'too many pages'; break; }
    console.warn(`[ga4] ${dim.api} rejected [${metrics.join(',')}], trying fewer metrics`);
  }
  console.error(`[ga4] ${dim.api} failed:`, lastError);
  return { ok: false, error: lastError };
}
