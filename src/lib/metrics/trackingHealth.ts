// Tracking health: is collection working? Events received per day, what the collector
// refused and why, bot share, and orders mirrored per day (to compare with Shopify).
// Raw ingestion, so the bot/test switches don't apply here.
import {
  addDays, both, column, countCell, meta, metric, num0, rateCell, table, type Row, type Run,
} from './core.ts';
import type { HealthDay, MetricsParams, Period, TrackingHealthResponse, ValueKey } from './types.ts';

const SQL = `
  SELECT day::text AS day, kind, name, n, bots
  FROM v_tracking_health
  WHERE day BETWEEN $1::date AND $2::date`;

async function load(run: Run, period: Period): Promise<Row[]> {
  return run(SQL, [period.from, period.to]);
}

function days(period: Period, rows: Row[]): HealthDay[] {
  const out = new Map<string, HealthDay>();
  for (let i = period.days - 1; i >= 0; i--) {
    const day = addDays(period.from, i);
    out.set(day, { day, events: 0, botEvents: 0, pageViews: 0, rejects: 0, orders: 0 });
  }
  for (const r of rows) {
    const d = out.get(String(r.day));
    if (!d) continue;
    const n = num0(r.n);
    if (r.kind === 'event') {
      d.events += n;
      d.botEvents += num0(r.bots);
      if (r.name === 'page_view') d.pageViews += n;
    } else if (r.kind === 'reject') d.rejects += n;
    else if (r.kind === 'order') d.orders += n;
  }
  return [...out.values()];
}

function byName(cur: Row[], prev: Row[], kind: string, def: 'healthRejects' | 'healthEvents') {
  const sum = (rows: Row[]) => {
    const m = new Map<string, number>();
    for (const r of rows) if (r.kind === kind) m.set(String(r.name), (m.get(String(r.name)) ?? 0) + num0(r.n));
    return [...m].map(([name, n]) => ({ name, n }));
  };
  return table<ValueKey>([column('n', def)], sum(cur), sum(prev), (r) => String(r.name), (c, p, first) => ({
    key: { value: String(first.name) },
    label: String(first.name),
    cells: { n: countCell(num0(c.n), num0(p.n)) },
  }));
}

export async function getTrackingHealth(run: Run, p: MetricsParams): Promise<TrackingHealthResponse> {
  const [curRows, prevRows] = await both(p, (per) => load(run, per));
  const { period, previous } = meta('trackingHealth', p);
  const cur = days(period, curRows), prev = days(previous, prevRows);
  const sum = (ds: HealthDay[], k: keyof Omit<HealthDay, 'day'>) => ds.reduce((s, d) => s + d[k], 0);
  const dead = (ds: HealthDay[]) => ds.filter((d) => d.pageViews === 0).length;
  return {
    ...meta('trackingHealth', p, [
      'Orders per day should match Shopify exactly; a gap means a webhook was missed.',
    ]),
    section: 'trackingHealth',
    kpis: {
      events: metric('events', 'healthEvents', countCell(sum(cur, 'events'), sum(prev, 'events'))),
      rejectRate: metric('rejectRate', 'healthRejectRate', rateCell(
        sum(cur, 'rejects'), sum(cur, 'events') + sum(cur, 'rejects'),
        sum(prev, 'rejects'), sum(prev, 'events') + sum(prev, 'rejects'))),
      botShare: metric('botShare', 'healthBotShare', rateCell(
        sum(cur, 'botEvents'), sum(cur, 'events'), sum(prev, 'botEvents'), sum(prev, 'events'))),
      daysWithoutPageViews: metric('daysWithoutPageViews', 'healthNoPageViews', countCell(dead(cur), dead(prev))),
    },
    days: cur,
    rejectReasons: byName(curRows, prevRows, 'reject', 'healthRejects'),
    eventNames: byName(curRows, prevRows, 'event', 'healthEvents'),
  };
}
