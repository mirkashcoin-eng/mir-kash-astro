// Retention: do people come back and buy again, and how long does buying take?
// Headline rates from v_sessions / v_orders / v_order_touch; cohorts from v_cohorts_weekly.
import {
  both, FILTER, medianCell, meta, metric, num, num0, rangeArgs, rateCell, type Row, type Run,
} from './core.ts';
import type { CohortRow, MetricsParams, Period, RetentionResponse } from './types.ts';

const MAX_WEEKS = 12;

const KPI_SQL = `
  WITH s AS MATERIALIZED (
    SELECT DISTINCT who, who_first_seen FROM v_sessions
    WHERE started_at >= $1 AND started_at < $2 AND ${FILTER}
  ), o AS MATERIALIZED (
    SELECT person_id, nth FROM v_orders
    WHERE created_at >= $1 AND created_at < $2 AND ($4::boolean OR NOT is_test) AND person_id IS NOT NULL
  ), f AS MATERIALIZED (
    SELECT extract(epoch FROM created_at - first_touch_at) / 86400 AS days, sessions_to_order
    FROM v_order_touch
    WHERE created_at >= $1 AND created_at < $2 AND ($4::boolean OR NOT is_test)
      AND nth = 1 AND first_touch_at IS NOT NULL
  )
  SELECT
    (SELECT count(DISTINCT who) FROM s) AS visitors,
    (SELECT count(DISTINCT who) FROM s WHERE who_first_seen < $1) AS returning,
    (SELECT count(DISTINCT person_id) FROM o) AS buyers,
    (SELECT count(DISTINCT person_id) FROM o WHERE nth > 1) AS repeat_buyers,
    (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY days) FROM f) AS median_days,
    (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY sessions_to_order) FROM f) AS median_sessions,
    (SELECT count(*) FROM f) AS first_orders`;

// Cohorts first seen in the period (from the Monday of its first week).
const COHORT_SQL = `
  WITH c AS MATERIALIZED (
    SELECT * FROM v_cohorts_weekly
    WHERE cohort_week BETWEEN date_trunc('week', $1::date)::date AND $2::date AND ${FILTER}
  ), size AS (
    SELECT cohort_week, sum(cohort_size) AS size
    FROM (SELECT DISTINCT cohort_week, is_bot, is_test, cohort_size FROM c) x
    GROUP BY cohort_week
  )
  SELECT c.cohort_week::text AS cohort_week, c.weeks_since, size.size,
         sum(c.active) AS active, sum(c.buyers) AS buyers
  FROM c JOIN size USING (cohort_week)
  WHERE c.weeks_since <= ${MAX_WEEKS}
  GROUP BY c.cohort_week, c.weeks_since, size.size
  ORDER BY c.cohort_week, c.weeks_since`;

async function kpis(run: Run, period: Period, p: MetricsParams): Promise<Row> {
  const [r] = await run(KPI_SQL, rangeArgs(period, p));
  return r ?? {};
}

export async function cohorts(run: Run, p: MetricsParams): Promise<CohortRow[]> {
  const rows = await run(COHORT_SQL, [p.from, p.to, p.includeBots, p.includeTest]);
  const out = new Map<string, CohortRow>();
  for (const r of rows) {
    const week = String(r.cohort_week);
    const size = num0(r.size);
    let row = out.get(week);
    if (!row) { row = { cohortWeek: week, size, weeks: [] }; out.set(week, row); }
    row.weeks.push({
      weeksSince: num0(r.weeks_since),
      active: rateCell(num0(r.active), size, null, null),
      buyers: rateCell(num0(r.buyers), size, null, null),
    });
  }
  return [...out.values()];
}

export async function getRetention(run: Run, p: MetricsParams): Promise<RetentionResponse> {
  const [[cur, prev], cohortRows] = await Promise.all([both(p, (per) => kpis(run, per, p)), cohorts(run, p)]);
  const n = (r: Row, k: string) => num0(r[k]);
  return {
    ...meta('retention', p, [
      'Cohorts group people by the week they were first seen; each cell is the share who came back (or bought) that many weeks later.',
    ]),
    section: 'retention',
    kpis: {
      returningVisitorShare: metric('returningVisitorShare', 'returningVisitorShare',
        rateCell(n(cur, 'returning'), n(cur, 'visitors'), n(prev, 'returning'), n(prev, 'visitors'))),
      repeatPurchaseRate: metric('repeatPurchaseRate', 'repeatPurchaseRate',
        rateCell(n(cur, 'repeat_buyers'), n(cur, 'buyers'), n(prev, 'repeat_buyers'), n(prev, 'buyers'))),
      medianDaysToFirstOrder: metric('medianDaysToFirstOrder', 'medianDaysToFirstOrder',
        medianCell(num(cur.median_days), n(cur, 'first_orders'), num(prev.median_days))),
      medianSessionsToFirstOrder: metric('medianSessionsToFirstOrder', 'medianSessionsToFirstOrder',
        medianCell(num(cur.median_sessions), n(cur, 'first_orders'), num(prev.median_sessions))),
    },
    cohorts: cohortRows,
  };
}
