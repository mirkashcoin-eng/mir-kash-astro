// Acquisition: which sources, campaigns and ads bring visitors, leads and buyers —
// and, where ad spend is known, what each sale cost. From v_acquisition.
import {
  both, column, countCell, FILTER, meta, num, num0, rangeArgs, ratio, rateCell, SMALL_SAMPLE, table, type Row, type Run,
} from './core.ts';
import type { AcquisitionBy, AcquisitionKey, AcquisitionResponse, Cell, MetricsParams, Period } from './types.ts';

const GROUP: Record<AcquisitionBy, string[]> = {
  source: ['source'],
  source_medium: ['source', 'medium'],
  campaign: ['campaign'],
  content: ['campaign', 'content'],
};

// Spend has no source/medium, so it only lines up at campaign and ad level.
const hasSpend = (by: AcquisitionBy) => by === 'campaign' || by === 'content';

function sql(by: AcquisitionBy): string {
  const cols = GROUP[by].join(', ');
  return `
    SELECT ${cols},
           count(*) FILTER (WHERE kind = 'session') AS sessions,
           count(DISTINCT who) FILTER (WHERE kind = 'session') AS visitors,
           count(DISTINCT who) FILTER (WHERE kind = 'lead') AS leads,
           count(*) FILTER (WHERE kind = $5) AS orders,
           COALESCE(sum(revenue_inr) FILTER (WHERE kind = $5), 0) AS revenue,
           sum(spend_inr) FILTER (WHERE kind = 'spend') AS spend
    FROM v_acquisition
    WHERE ts >= $1 AND ts < $2 AND ${FILTER}
      AND kind IN ('session', 'lead', $5${hasSpend(by) ? ", 'spend'" : ''})
    GROUP BY ${cols}`;
}

async function load(run: Run, period: Period, p: MetricsParams, by: AcquisitionBy): Promise<Row[]> {
  const kind = p.model === 'first' ? 'order_first' : 'order';
  return run(sql(by), [...rangeArgs(period, p), kind]);
}

function keyOf(by: AcquisitionBy, r: Row): AcquisitionKey {
  const k: AcquisitionKey = {};
  for (const c of GROUP[by]) k[c as keyof AcquisitionKey] = String(r[c] ?? '(none)');
  return k;
}

export async function getAcquisition(run: Run, p: MetricsParams): Promise<AcquisitionResponse> {
  const by = p.by ?? 'source';
  const model = p.model ?? 'last';
  const [cur, prev] = await both(p, (per) => load(run, per, p, by));
  const spendAvailable = hasSpend(by) && cur.some((r) => num0(r.spend) > 0);
  const cost = (orders: number, spend: number | null): number | null => (spend ? ratio(spend, orders) : null);
  const roas = (revenue: number, spend: number | null): number | null => (spend ? ratio(revenue, spend) : null);

  const columns = [
    column('sessions', 'sessions'),
    column('visitors', 'visitors'),
    column('leads', 'leads'),
    column('leadRate', 'leadRate'),
    column('orders', model === 'first' ? 'attributedOrdersFirst' : 'attributedOrdersLast'),
    column('revenue', 'attributedRevenue'),
    column('conversionRate', 'channelConversion'),
    ...(hasSpend(by) ? [column('spend', 'spend'), column('costPerSale', 'costPerSale'), column('roas', 'roas')] : []),
  ];

  return {
    ...meta('acquisition', p, [
      model === 'first'
        ? 'Orders are credited to the first visit the buyer ever made.'
        : 'Orders are credited to the last visit the buyer made before ordering.',
      ...(hasSpend(by) ? [] : ['Ad spend, cost per sale and ROAS show when grouped by campaign or ad.']),
    ]),
    section: 'acquisition',
    by,
    model,
    spendAvailable,
    table: table<AcquisitionKey>(columns, cur, prev, (r) => GROUP[by].map((c) => String(r[c] ?? '')).join('\u0001'), (c, pr, first) => {
      const key = keyOf(by, first);
      const n = (r: Row, k: string) => num0(r[k]);
      const spend = num(c.spend), pSpend = num(pr.spend);
      const cells: Record<string, Cell> = {
        sessions: countCell(n(c, 'sessions'), n(pr, 'sessions')),
        visitors: countCell(n(c, 'visitors'), n(pr, 'visitors')),
        leads: countCell(n(c, 'leads'), n(pr, 'leads')),
        leadRate: rateCell(n(c, 'leads'), n(c, 'visitors'), n(pr, 'leads'), n(pr, 'visitors')),
        orders: countCell(n(c, 'orders'), n(pr, 'orders')),
        revenue: countCell(n(c, 'revenue'), n(pr, 'revenue')),
        conversionRate: rateCell(n(c, 'orders'), n(c, 'sessions'), n(pr, 'orders'), n(pr, 'sessions')),
      };
      if (hasSpend(by)) {
        cells.spend = countCell(spend, pSpend);
        cells.costPerSale = { ...countCell(cost(n(c, 'orders'), spend), cost(n(pr, 'orders'), pSpend)), num: spend ?? 0, den: n(c, 'orders'), smallSample: n(c, 'orders') < SMALL_SAMPLE };
        cells.roas = { ...countCell(roas(n(c, 'revenue'), spend), roas(n(pr, 'revenue'), pSpend)), smallSample: n(c, 'orders') < SMALL_SAMPLE };
      }
      return { key, label: Object.values(key).join(' / '), cells };
    }),
  };
}
