// Audience: who visits and who buys. Device / OS / browser / city / country come from
// our own visits (v_sessions), so they join to orders; age / gender / interests exist
// only as Google Analytics totals (ga_audience_daily), shown as GA reports them.
import {
  both, column, countCell, dayArgs, FILTER, medianCell, meta, metric, num, num0, rangeArgs, rateCell, table,
  type Row, type Run,
} from './core.ts';
import type {
  AudienceResponse, GaBreakdown, GaDimension, MetricsParams, OwnDimension, Period, Table, ValueKey,
} from './types.ts';

const OWN: OwnDimension[] = ['device', 'os', 'browser', 'city', 'country'];
const GA: GaDimension[] = ['age', 'gender', 'interest'];
const TOP = 20;

// One GROUPING SETS pass: a row per (dimension, value), plus the overall total.
const OWN_SQL = `
  WITH s AS MATERIALIZED (
    SELECT who, device, os, browser, city, country, engaged_ms
    FROM v_sessions
    WHERE started_at >= $1 AND started_at < $2 AND ${FILTER}
  ), b AS (
    SELECT DISTINCT person_id AS who FROM v_orders
    WHERE created_at >= $1 AND created_at < $2 AND ($4::boolean OR NOT is_test) AND person_id IS NOT NULL
  )
  SELECT CASE WHEN GROUPING(s.device) = 0 THEN 'device' WHEN GROUPING(s.os) = 0 THEN 'os'
              WHEN GROUPING(s.browser) = 0 THEN 'browser' WHEN GROUPING(s.city) = 0 THEN 'city'
              WHEN GROUPING(s.country) = 0 THEN 'country' ELSE 'total' END AS dim,
         COALESCE(s.device, s.os, s.browser, s.city, s.country, '(unknown)') AS value,
         count(DISTINCT s.who) AS visitors,
         count(*) AS sessions,
         percentile_cont(0.5) WITHIN GROUP (ORDER BY s.engaged_ms) AS median_ms,
         count(s.engaged_ms) AS n_ms,
         count(DISTINCT s.who) FILTER (WHERE b.who IS NOT NULL) AS buyers
  FROM s LEFT JOIN b ON b.who = s.who
  GROUP BY GROUPING SETS ((s.device), (s.os), (s.browser), (s.city), (s.country), ())`;

const GA_SQL = `
  SELECT dimension, value, sum(users) AS users, sum(sessions) AS sessions, sum(conversions) AS conversions
  FROM ga_audience_daily
  WHERE day BETWEEN $1::date AND $2::date AND dimension = ANY ($3::text[])
  GROUP BY dimension, value`;

// likely_gift is NULL when the order didn't carry enough to judge; those are left out.
const GIFT_SQL = `
  SELECT count(*) FILTER (WHERE likely_gift) AS gifts, count(likely_gift) AS judged
  FROM v_orders
  WHERE created_at >= $1 AND created_at < $2 AND ($4::boolean OR NOT is_test)
    AND ($3::boolean OR true) -- $3 (bots) can't apply to orders; typed so the shared args fit`;

async function load(run: Run, period: Period, p: MetricsParams): Promise<{ own: Row[]; ga: Row[]; gift: Row }> {
  const [own, ga, gift] = await Promise.all([
    run(OWN_SQL, rangeArgs(period, p)),
    run(GA_SQL, [...dayArgs(period, p).slice(0, 2), GA]),
    run(GIFT_SQL, rangeArgs(period, p)),
  ]);
  return { own, ga, gift: gift[0] ?? {} };
}

function ownTable(dim: OwnDimension, cur: Row[], prev: Row[]): Table<ValueKey> {
  const total = (rows: Row[]) => num0(rows.find((r) => r.dim === 'total')?.visitors);
  const ct = total(cur), pt = total(prev);
  const t = table<ValueKey>(
    [column('visitors', 'audienceVisitors'), column('share', 'audienceShare'), column('sessions', 'sessions'),
      column('medianEngagedMs', 'medianEngagedPerSession'), column('buyers', 'audienceBuyers'),
      column('conversionRate', 'audienceConversion')],
    cur.filter((r) => r.dim === dim), prev.filter((r) => r.dim === dim), (r) => String(r.value),
    (c, pr, first) => ({
      key: { value: String(first.value) },
      label: String(first.value),
      cells: {
        visitors: countCell(num0(c.visitors), num0(pr.visitors)),
        share: rateCell(num0(c.visitors), ct, num0(pr.visitors), pt),
        sessions: countCell(num0(c.sessions), num0(pr.sessions)),
        medianEngagedMs: medianCell(num(c.median_ms), num0(c.n_ms), num(pr.median_ms)),
        buyers: countCell(num0(c.buyers), num0(pr.buyers)),
        conversionRate: rateCell(num0(c.buyers), num0(c.visitors), num0(pr.buyers), num0(pr.visitors)),
      },
    }),
  );
  t.rows = t.rows.slice(0, TOP);
  return t;
}

function gaBreakdown(dim: GaDimension, cur: Row[], prev: Row[]): GaBreakdown {
  const c = cur.filter((r) => r.dimension === dim), pr = prev.filter((r) => r.dimension === dim);
  const sum = (rows: Row[]) => rows.reduce((s, r) => s + num0(r.users), 0);
  const ct = sum(c), pt = sum(pr);
  const t = table<ValueKey>(
    [column('users', 'gaUsers'), column('share', 'gaShare'), column('sessions', 'gaSessions'),
      column('conversions', 'gaConversions')],
    c, pr, (r) => String(r.value),
    (x, y, first) => ({
      key: { value: String(first.value) },
      label: String(first.value),
      cells: {
        users: countCell(num0(x.users), num0(y.users)),
        share: rateCell(num0(x.users), ct, num0(y.users), pt),
        sessions: countCell(num0(x.sessions), num0(y.sessions)),
        conversions: countCell(num0(x.conversions), num0(y.conversions)),
      },
    }),
  );
  t.rows = t.rows.slice(0, TOP);
  const available = c.length > 0;
  return {
    available,
    note: available ? null : 'Not enough data — Google hides groups too small to keep people anonymous.',
    table: t,
  };
}

export async function getAudience(run: Run, p: MetricsParams): Promise<AudienceResponse> {
  const [cur, prev] = await both(p, (per) => load(run, per, p));
  const own = Object.fromEntries(OWN.map((d) => [d, ownTable(d, cur.own, prev.own)])) as Record<OwnDimension, Table<ValueKey>>;
  const ga = Object.fromEntries(GA.map((d) => [d, gaBreakdown(d, cur.ga, prev.ga)])) as Record<GaDimension, GaBreakdown>;
  return {
    ...meta('audience', p, [
      'Age, gender and interests come from Google Analytics, which ad blockers hide for an estimated 15–30% of visitors; GA has no bot/test filter of ours.',
    ]),
    section: 'audience',
    own,
    ga,
    giftOrders: metric('giftOrders', 'giftOrders',
      rateCell(num0(cur.gift.gifts), num0(cur.gift.judged), num0(prev.gift.gifts), num0(prev.gift.judged))),
  };
}
