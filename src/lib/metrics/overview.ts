// Overview: the headline numbers, the purchase funnel and the daily trend.
import {
  addDays, both, countCell, dayArgs, FILTER, medianCell, meta, metric, num, num0, periods, rangeArgs, rateCell,
  type Row, type Run,
} from './core.ts';
import type { DefKey } from './definitions.ts';
import type { FunnelStep, MetricsParams, OverviewResponse, Period, TrendPoint } from './types.ts';

// One pass per period. `s` = the visits that started in the range; the funnel steps
// count only those visitors, so each step is a subset of the one before.
const SQL = `
  WITH s AS MATERIALIZED (
    SELECT who, who_first_seen, engaged_ms, engaged
    FROM v_sessions
    WHERE started_at >= $1 AND started_at < $2 AND ${FILTER}
  ), w AS MATERIALIZED (
    SELECT DISTINCT who FROM s
  ), ev AS MATERIALIZED (
    SELECT e.name, count(DISTINCT e.who) AS people
    FROM v_events e
    WHERE e.ts >= $1 AND e.ts < $2 AND ${FILTER}
      AND e.name IN ('product_view', 'add_to_cart', 'checkout_start', 'payment_start')
      AND e.who IN (SELECT who FROM w)
    GROUP BY e.name
  ), o AS MATERIALIZED (
    SELECT person_id, revenue_inr
    FROM v_orders
    WHERE created_at >= $1 AND created_at < $2 AND ($4::boolean OR NOT is_test)
  )
  SELECT
    (SELECT count(*) FROM w) AS visitors,
    (SELECT count(DISTINCT who) FROM s WHERE who_first_seen >= $1) AS new_visitors,
    (SELECT count(*) FROM s) AS sessions,
    (SELECT count(*) FROM s WHERE engaged) AS engaged_sessions,
    (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY engaged_ms) FROM s) AS median_session_ms,
    (SELECT count(engaged_ms) FROM s) AS n_session_ms,
    (SELECT json_object_agg(name, people) FROM ev) AS steps,
    (SELECT count(*) FROM o) AS orders,
    (SELECT COALESCE(sum(revenue_inr), 0) FROM o) AS revenue,
    (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY revenue_inr) FROM o) AS median_order,
    (SELECT count(revenue_inr) FROM o) AS n_order_value,
    (SELECT count(DISTINCT person_id) FROM o WHERE person_id IN (SELECT who FROM w)) AS buyers`;

// Visitors, visits and sales per IST day (v_traffic_daily), oldest first; every day
// of the period is present.
const TREND_SQL = `
  SELECT day::text AS day, bool_or(legacy) AS legacy, sum(visitors) AS visitors, sum(sessions) AS sessions,
         sum(orders) AS orders, sum(revenue_inr) AS revenue_inr
  FROM v_traffic_daily
  WHERE day BETWEEN $1::date AND $2::date AND ${FILTER}
  GROUP BY day`;

async function trend(run: Run, period: Period, p: MetricsParams): Promise<TrendPoint[]> {
  const rows = new Map((await run(TREND_SQL, dayArgs(period, p))).map((r) => [String(r.day), r]));
  return Array.from({ length: period.days }, (_, i) => {
    const day = addDays(period.from, i);
    const r = rows.get(day) ?? {};
    return {
      day, legacy: r.legacy === true, visitors: num(r.visitors), sessions: num(r.sessions),
      orders: num0(r.orders), revenueInr: num0(r.revenue_inr),
    };
  });
}

async function load(run: Run, period: Period, p: MetricsParams): Promise<Row> {
  const [r] = await run(SQL, rangeArgs(period, p));
  return r ?? {};
}

const STEPS: [string, DefKey, (r: Row) => number][] = [
  ['visitors', 'visitors', (r) => num0(r.visitors)],
  ['viewedProduct', 'viewedProduct', (r) => step(r, 'product_view')],
  ['addedToCart', 'addedToCart', (r) => step(r, 'add_to_cart')],
  ['startedCheckout', 'startedCheckout', (r) => step(r, 'checkout_start')],
  ['startedPayment', 'startedPayment', (r) => step(r, 'payment_start')],
  ['ordered', 'ordered', (r) => num0(r.buyers)],
];

function step(r: Row, name: string): number {
  const s = (r.steps ?? {}) as Record<string, unknown>;
  return num0(s[name]);
}

export function funnel(cur: Row, prev: Row): FunnelStep[] {
  return STEPS.map(([key, def, get], i) => {
    const c = get(cur), pr = get(prev);
    const before = i ? STEPS[i - 1][2] : null;
    return {
      ...metric(key, def, countCell(c, pr)),
      fromPrevious: before ? rateCell(c, before(cur), pr, before(prev)) : null,
    };
  });
}

export async function getOverview(run: Run, p: MetricsParams): Promise<OverviewResponse> {
  const [[cur, prev], days] = await Promise.all([
    both(p, (per) => load(run, per, p)),
    trend(run, periods(p).current, p),
  ]);
  const visitors = num0(cur.visitors), pVisitors = num0(prev.visitors);
  const newV = num0(cur.new_visitors), pNewV = num0(prev.new_visitors);
  return {
    ...meta('overview', p),
    section: 'overview',
    kpis: {
      visitors: metric('visitors', 'visitors', countCell(visitors, pVisitors)),
      newVisitors: metric('newVisitors', 'newVisitors', countCell(newV, pNewV)),
      returningVisitors: metric('returningVisitors', 'returningVisitors', countCell(visitors - newV, pVisitors - pNewV)),
      sessions: metric('sessions', 'sessions', countCell(num0(cur.sessions), num0(prev.sessions))),
      engagedSessionRate: metric('engagedSessionRate', 'engagedSessionRate',
        rateCell(num0(cur.engaged_sessions), num0(cur.sessions), num0(prev.engaged_sessions), num0(prev.sessions))),
      medianEngagedPerSession: metric('medianEngagedPerSession', 'medianEngagedPerSession',
        medianCell(num(cur.median_session_ms), num0(cur.n_session_ms), num(prev.median_session_ms))),
      orders: metric('orders', 'orders', countCell(num0(cur.orders), num0(prev.orders))),
      revenue: metric('revenue', 'revenue', countCell(num0(cur.revenue), num0(prev.revenue))),
      medianOrderValue: metric('medianOrderValue', 'medianOrderValue',
        medianCell(num(cur.median_order), num0(cur.n_order_value), num(prev.median_order))),
      conversionRate: metric('conversionRate', 'conversionRate',
        rateCell(num0(cur.buyers), visitors, num0(prev.buyers), pVisitors)),
    },
    funnel: funnel(cur, prev),
    trend: days,
  };
}
