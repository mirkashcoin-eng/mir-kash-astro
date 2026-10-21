import type { APIRoute } from 'astro';
import { q, tx, pg } from '~/lib/db';
import { GA_DIMENSIONS, dateRange, fetchAudience, ga4Config, syncDays } from '~/lib/ga4';

export const prerender = false;

// Nightly GA4 → Neon sync of audience totals (age, gender, interests, device, city…)
// into ga_audience_daily. GA keeps revising the last couple of days, so every run
// re-pulls the last 3 complete days; the first run (empty table) backfills 90.
// `?days=N` forces a longer window for a manual re-pull (max 365).
//
// Per dimension, inside one transaction: upsert what GA reported, then delete rows
// in the window that GA no longer reports (a group can fall under GA's privacy
// threshold on a later pull). A dimension that fails leaves its old rows untouched.
// Best-effort: one dimension failing doesn't stop the others. Runs on a Vercel
// cron; can be hit manually with the CRON_SECRET bearer.

const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj, null, 2), {
    status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

export const GET: APIRoute = async ({ request, url }) => {
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get('authorization') !== `Bearer ${secret}`) {
    return new Response('unauthorized', { status: 401 });
  }

  const cfg = ga4Config();
  if (!cfg) return json({ ok: false, configured: false, reason: 'GA4_PROPERTY_ID or service account not set' });
  if (!pg()) return json({ ok: false, configured: false, reason: 'DATABASE_URL not set' });

  const any = await q<{ any: boolean }>('SELECT EXISTS (SELECT 1 FROM ga_audience_daily) AS any');
  if (!any) return json({ ok: false, reason: 'could not read ga_audience_daily (migration run?)' }, 500);
  const tableEmpty = !any[0]?.any;
  const daysParam = url.searchParams.get('days');
  const days = syncDays(tableEmpty, daysParam ? Number(daysParam) : null);
  const range = dateRange(new Date(), days);

  const results: Record<string, unknown>[] = [];
  for (const dim of GA_DIMENSIONS) {
    const got = await fetchAudience(dim, range);
    if (!got || !got.ok) {
      results.push({ dimension: dim.key, api: dim.api, ok: false, error: got ? got.error : 'not configured' });
      continue;
    }
    const hasConversions = got.rows.every((r) => r.conversions != null);
    try {
      await tx(async (c) => {
        if (got.rows.length) {
          // Brand-new rows without a conversions metric get the column default (0,
          // NOT NULL in the schema); existing rows keep their last real value.
          await c.query(
            `INSERT INTO ga_audience_daily (day, dimension, value, users, sessions, conversions)
             SELECT t.d, $2, t.v, t.u, t.s, COALESCE(t.c, 0)
               FROM unnest($1::date[], $3::text[], $4::int[], $5::int[], $6::int[]) AS t(d, v, u, s, c)
             ON CONFLICT (day, dimension, value) DO UPDATE SET
               users = EXCLUDED.users,
               sessions = EXCLUDED.sessions,
               conversions = CASE WHEN $7 THEN EXCLUDED.conversions ELSE ga_audience_daily.conversions END`,
            [
              got.rows.map((r) => r.day), dim.key, got.rows.map((r) => r.value),
              got.rows.map((r) => r.users), got.rows.map((r) => r.sessions),
              got.rows.map((r) => r.conversions), hasConversions,
            ],
          );
        }
        await c.query(
          `DELETE FROM ga_audience_daily g
            WHERE g.dimension = $1 AND g.day BETWEEN $2::date AND $3::date
              AND NOT EXISTS (SELECT 1 FROM unnest($4::date[], $5::text[]) AS t(d, v)
                               WHERE t.d = g.day AND t.v = g.value)`,
          [dim.key, range.startDate, range.endDate, got.rows.map((r) => r.day), got.rows.map((r) => r.value)],
        );
      });
      results.push({
        dimension: dim.key, api: dim.api, ok: true, rows: got.rows.length,
        metrics: got.metrics, thresholded: got.thresholded, otherRow: got.otherRow,
      });
    } catch (e) {
      console.error(`[ga-sync] write failed for ${dim.key}:`, e);
      results.push({ dimension: dim.key, api: dim.api, ok: false, error: `db write failed: ${String(e).slice(0, 200)}` });
    }
  }

  const failed = results.filter((r) => !r.ok).length;
  return json({
    ok: failed === 0,
    propertyId: cfg.propertyId,
    serviceAccount: cfg.sa.client_email,
    credentialsFrom: cfg.saSource,
    backfill: tableEmpty,
    days,
    range,
    failed,
    dimensions: results,
  });
};
