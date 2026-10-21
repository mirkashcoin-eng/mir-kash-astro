// Checkout: where money is lost between cart and order — step drop-off, OTP and
// payment failures by reason, payment methods and coupon codes. From v_checkout_steps.
import {
  both, column, countCell, FILTER, meta, metric, num0, rangeArgs, rateCell, table, type Row, type Run,
} from './core.ts';
import type { DefKey } from './definitions.ts';
import type { CheckoutResponse, FunnelStep, MetricsParams, Period, ValueKey } from './types.ts';

// One result set per period: kind = 'step' | 'otp_failed' | 'payment_failed' |
// 'method' | 'coupon', key = step / reason / method / code.
const SQL = `
  WITH c AS MATERIALIZED (
    SELECT * FROM v_checkout_steps
    WHERE ts >= $1 AND ts < $2 AND ${FILTER}
  )
  SELECT 'step' AS kind, step AS key, count(DISTINCT who) AS people, count(*) AS events, 0 AS valid, 0 AS invalid
  FROM c WHERE step NOT IN ('phone', 'address') OR in_checkout
  GROUP BY step
  UNION ALL
  SELECT step, COALESCE(reason, '(no reason given)'), count(DISTINCT who), count(*), 0, 0
  FROM c WHERE step IN ('otp_failed', 'payment_failed')
  GROUP BY step, 2
  UNION ALL
  SELECT 'method', COALESCE(method, '(unknown)'), count(DISTINCT who), count(*), 0, 0
  FROM c WHERE step = 'payment_method'
  GROUP BY 2
  UNION ALL
  SELECT 'coupon', COALESCE(coupon, '(blank)'), count(DISTINCT who), count(*),
         count(*) FILTER (WHERE coupon_valid), count(*) FILTER (WHERE NOT coupon_valid)
  FROM c WHERE step = 'coupon_apply'
  GROUP BY 2`;

async function load(run: Run, period: Period, p: MetricsParams): Promise<Row[]> {
  return run(SQL, rangeArgs(period, p));
}

const STEPS: [string, DefKey][] = [
  ['add_to_cart', 'ckCart'],
  ['checkout_start', 'ckStart'],
  ['otp_sent', 'ckOtpSent'],
  ['otp_verified', 'ckOtpVerified'],
  ['phone', 'ckPhone'],
  ['address', 'ckAddress'],
  ['payment_method', 'ckMethod'],
  ['payment_start', 'ckPayment'],
  ['payment_success', 'ckPaid'],
  ['order', 'ckOrdered'],
];

const of = (rows: Row[], kind: string) => rows.filter((r) => r.kind === kind);
const people = (rows: Row[], kind: string, key: string) =>
  num0(rows.find((r) => r.kind === kind && r.key === key)?.people);

// people / events / share-of-people for one breakdown.
function breakdown(cur: Row[], prev: Row[], kind: string) {
  const c = of(cur, kind), pr = of(prev, kind);
  const tot = (rows: Row[]) => rows.reduce((s, r) => s + num0(r.events), 0);
  const ct = tot(c), pt = tot(pr);
  return table<ValueKey>(
    [column('events', 'events'), column('people', 'people'), column('share', 'share')],
    c, pr, (r) => String(r.key),
    (x, y, first) => ({
      key: { value: String(first.key) },
      label: String(first.key),
      cells: {
        events: countCell(num0(x.events), num0(y.events)),
        people: countCell(num0(x.people), num0(y.people)),
        share: rateCell(num0(x.events), ct, num0(y.events), pt),
      },
    }),
  );
}

export async function getCheckout(run: Run, p: MetricsParams): Promise<CheckoutResponse> {
  const [cur, prev] = await both(p, (per) => load(run, per, p));
  const steps: FunnelStep[] = STEPS.map(([key, def], i) => {
    const c = people(cur, 'step', key), pr = people(prev, 'step', key);
    const before = i ? STEPS[i - 1][0] : null;
    return {
      ...metric(key, def, countCell(c, pr)),
      fromPrevious: before ? rateCell(c, people(cur, 'step', before), pr, people(prev, 'step', before)) : null,
    };
  });
  const failRate = (fail: string, base: string, def: DefKey) => metric(def, def, rateCell(
    people(cur, 'step', fail), people(cur, 'step', base), people(prev, 'step', fail), people(prev, 'step', base)));

  return {
    ...meta('checkout', p, [
      'Steps count different people. Not every step is sent by every checkout yet; a step at 0 may simply not be tracked.',
    ]),
    section: 'checkout',
    steps,
    kpis: {
      otpFailureRate: failRate('otp_failed', 'otp_sent', 'otpFailureRate'),
      paymentFailureRate: failRate('payment_failed', 'payment_start', 'paymentFailureRate'),
    },
    otpFailures: breakdown(cur, prev, 'otp_failed'),
    paymentFailures: breakdown(cur, prev, 'payment_failed'),
    paymentMethods: breakdown(cur, prev, 'method'),
    coupons: table<ValueKey>(
      [column('tries', 'couponTries'), column('valid', 'couponValid'), column('invalid', 'couponInvalid')],
      of(cur, 'coupon'), of(prev, 'coupon'), (r) => String(r.key),
      (x, y, first) => ({
        key: { value: String(first.key) },
        label: String(first.key),
        cells: {
          tries: countCell(num0(x.events), num0(y.events)),
          valid: countCell(num0(x.valid), num0(y.valid)),
          invalid: countCell(num0(x.invalid), num0(y.invalid)),
        },
      }),
    ),
  };
}
