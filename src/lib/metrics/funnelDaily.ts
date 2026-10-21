// Daily funnel: the per-day grid (visitors → products → cart → … → orders), one row
// per IST day, from v_funnel_daily. Also feeds the Overview trend line.
import {
  addDays, both, column, countCell, dayArgs, FILTER, meta, metric, num, num0, type Run,
} from './core.ts';
import type { DefKey } from './definitions.ts';
import type { FunnelDailyResponse, FunnelDayRow, MetricsParams, Period } from './types.ts';

const SQL = `
  SELECT day::text AS day, bool_or(legacy) AS legacy,
         sum(visitors) AS visitors, sum(new_visitors) AS new_visitors,
         sum(returning_visitors) AS returning_visitors, sum(sessions) AS sessions,
         sum(p1) AS p1, sum(p2) AS p2, sum(p3) AS p3, sum(cart) AS cart,
         sum(checkout_start) AS checkout_start, sum(phone) AS phone, sum(address) AS address,
         sum(payment_start) AS payment_start, sum(orders) AS orders, sum(revenue_inr) AS revenue_inr
  FROM v_funnel_daily
  WHERE day BETWEEN $1::date AND $2::date AND ${FILTER}
  GROUP BY day
  ORDER BY day DESC`;

// Every day of the period, newest first; days with no data at all are null rows.
export async function funnelDays(run: Run, period: Period, p: MetricsParams): Promise<FunnelDayRow[]> {
  const rows = await run(SQL, dayArgs(period, p));
  const got = new Map(rows.map((r) => [String(r.day), r]));
  const out: FunnelDayRow[] = [];
  for (let i = period.days - 1; i >= 0; i--) {
    const day = addDays(period.from, i);
    const r = got.get(day) ?? {};
    out.push({
      day,
      legacy: r.legacy === true,
      visitors: num(r.visitors),
      newVisitors: num(r.new_visitors),
      returningVisitors: num(r.returning_visitors),
      sessions: num(r.sessions),
      p1: num(r.p1), p2: num(r.p2), p3: num(r.p3),
      cart: num(r.cart),
      checkoutStart: num(r.checkout_start),
      phone: num(r.phone),
      address: num(r.address),
      paymentStart: num(r.payment_start),
      orders: num0(r.orders),
      revenueInr: num0(r.revenue_inr),
    });
  }
  return out;
}

const COLUMNS: [keyof FunnelDayRow, DefKey][] = [
  ['visitors', 'fdVisitors'], ['newVisitors', 'fdNewVisitors'], ['returningVisitors', 'fdReturning'],
  ['sessions', 'fdSessions'], ['p1', 'fdP1'], ['p2', 'fdP2'], ['p3', 'fdP3'], ['cart', 'fdCart'],
  ['checkoutStart', 'fdCheckout'], ['phone', 'fdPhone'], ['address', 'fdAddress'],
  ['paymentStart', 'fdPayment'], ['orders', 'fdOrders'], ['revenueInr', 'fdRevenue'],
];

// Columns that add up across days (visitors don't: one person on 3 days is 3).
const ADDITIVE = new Set<keyof FunnelDayRow>(['sessions', 'p1', 'p2', 'p3', 'cart', 'checkoutStart',
  'phone', 'address', 'paymentStart', 'orders', 'revenueInr']);

function total(rows: FunnelDayRow[], k: keyof FunnelDayRow): number | null {
  let s: number | null = null;
  for (const r of rows) { const v = r[k]; if (typeof v === 'number') s = (s ?? 0) + v; }
  return s;
}

export async function getFunnelDaily(run: Run, p: MetricsParams): Promise<FunnelDailyResponse> {
  const [cur, prev] = await both(p, (per) => funnelDays(run, per, p));
  return {
    ...meta('funnelDaily', p, [
      'Milestone columns count each person once, on the day they first reached that step, so they add up across days.',
      'Days before the event log come from the old Firestore counters (legacy) and lack some columns.',
    ]),
    section: 'funnelDaily',
    columns: COLUMNS.map(([k, d]) => column(k, d)),
    rows: cur,
    totals: COLUMNS.filter(([k]) => ADDITIVE.has(k)).map(([k, d]) => metric(k, d, countCell(total(cur, k), total(prev, k)))),
  };
}
