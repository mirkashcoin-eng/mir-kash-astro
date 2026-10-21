// Shared plumbing for the metrics sections: request params, IST periods, the
// bot/test filter, and the builders that turn query numbers into Metric / Cell.
// Pure — no database import — so tests can run the sections against any client by
// passing their own `run`.
import { DEFS, type DefKey } from './definitions.ts';
import type {
  AcquisitionBy, AttributionModel, Cell, Column, Metric, MetricsParams, Period, SectionMeta, SectionName,
  Table, TableRow,
} from './types.ts';

// Runs one parameterised query and returns its rows. The API passes a pool-backed
// one; tests pass a client inside a rolled-back transaction.
export type Row = Record<string, unknown>;
export type Run = (sql: string, params?: unknown[]) => Promise<Row[]>;

export const SMALL_SAMPLE = 30;
export const MAX_DAYS = 400;
export const DEFAULT_DAYS = 28;

// ── Dates (IST has no daylight saving: always UTC+05:30) ─────────────────────

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const IST_MS = 330 * 60e3;

export function istToday(now: Date = new Date()): string {
  return new Date(now.getTime() + IST_MS).toISOString().slice(0, 10);
}

export function addDays(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
}

export function isDay(v: unknown): v is string {
  return typeof v === 'string' && DATE.test(v) && addDays(v, 0) === v; // rejects 2026-02-30
}

// Inclusive day count.
export function spanDays(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 864e5) + 1;
}

// The period asked for, and the same number of days right before it.
export function periods(p: Pick<MetricsParams, 'from' | 'to'>): { current: Period; previous: Period } {
  const days = spanDays(p.from, p.to);
  const prevTo = addDays(p.from, -1);
  return {
    current: { from: p.from, to: p.to, days },
    previous: { from: addDays(prevTo, -(days - 1)), to: prevTo, days },
  };
}

// [start, end) of a period as timestamptz strings: IST midnight to IST midnight.
export function bounds(period: Period): [string, string] {
  return [`${period.from}T00:00:00+05:30`, `${addDays(period.to, 1)}T00:00:00+05:30`];
}

// ── Params ───────────────────────────────────────────────────────────────────

const BY: AcquisitionBy[] = ['source', 'source_medium', 'campaign', 'content'];
const MODEL: AttributionModel[] = ['last', 'first'];

function flag(v: string | null): boolean {
  return v === '1' || v === 'true' || v === 'yes';
}

// ?from=YYYY-MM-DD&to=YYYY-MM-DD&bots=1&test=1&by=campaign&model=first
// Missing dates → the last 28 days ending today (IST). Returns a message on bad input.
export function parseParams(q: URLSearchParams, now: Date = new Date()): MetricsParams | string {
  const today = istToday(now);
  const to = q.get('to') || today;
  const from = q.get('from') || addDays(to, -(DEFAULT_DAYS - 1));
  if (!isDay(from) || !isDay(to)) return 'from and to must be dates as YYYY-MM-DD';
  if (from > to) return 'from must not be after to';
  if (to > addDays(today, 1)) return 'to is in the future';
  if (spanDays(from, to) > MAX_DAYS) return `the range can be at most ${MAX_DAYS} days`;
  const by = q.get('by') || 'source';
  const model = q.get('model') || 'last';
  if (!BY.includes(by as AcquisitionBy)) return `by must be one of ${BY.join(', ')}`;
  if (!MODEL.includes(model as AttributionModel)) return `model must be one of ${MODEL.join(', ')}`;
  return {
    from, to,
    includeBots: flag(q.get('bots')),
    includeTest: flag(q.get('test')),
    by: by as AcquisitionBy,
    model: model as AttributionModel,
  };
}

// The four parameters most queries start with: $1 start, $2 end, $3 bots, $4 test.
export function rangeArgs(period: Period, p: MetricsParams): [string, string, boolean, boolean] {
  const [a, b] = bounds(period);
  return [a, b, p.includeBots, p.includeTest];
}

// Day-keyed rollups take the IST dates themselves.
export function dayArgs(period: Period, p: MetricsParams): [string, string, boolean, boolean] {
  return [period.from, period.to, p.includeBots, p.includeTest];
}

// The default exclusion, against a view's is_bot / is_test columns ($3 / $4).
export const FILTER = '($3::boolean OR NOT is_bot) AND ($4::boolean OR NOT is_test)';

export function meta(section: SectionName, p: MetricsParams, notes: string[] = []): SectionMeta {
  const { current, previous } = periods(p);
  return {
    section,
    period: current,
    previous,
    filters: { includeBots: p.includeBots, includeTest: p.includeTest },
    generatedAt: new Date().toISOString(),
    notes,
  };
}

// Run the same query for the current and previous period, side by side.
export async function both<T>(p: MetricsParams, fn: (period: Period) => Promise<T>): Promise<[T, T]> {
  const { current, previous } = periods(p);
  return Promise.all([fn(current), fn(previous)]);
}

// ── Numbers ──────────────────────────────────────────────────────────────────

// pg returns bigint / numeric as strings.
export function num(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// A number that is 0 when absent (sums and counts).
export function num0(v: unknown): number {
  return num(v) ?? 0;
}

export function ratio(a: number | null, b: number | null): number | null {
  return a == null || b == null || b === 0 ? null : a / b;
}

// A plain count or amount.
export function countCell(value: number | null, prev: number | null): Cell {
  return { value, prev, smallSample: false };
}

// A rate, with its parts.
export function rateCell(n: number, d: number, pn: number | null, pd: number | null): Cell {
  return {
    value: ratio(n, d), num: n, den: d,
    prev: ratio(pn, pd), ...(pn != null && pd != null ? { prevNum: pn, prevDen: pd } : {}),
    smallSample: d < SMALL_SAMPLE,
  };
}

// A median (or other per-observation figure), with how many observations.
export function medianCell(value: number | null, n: number, prev: number | null): Cell {
  return { value: n ? value : null, n, prev, smallSample: n < SMALL_SAMPLE };
}

// Name a Cell: attach the label, unit and definition from DEFS.
export function metric(key: string, def: DefKey, cell: Cell): Metric {
  const x = DEFS[def];
  return { key, label: x.label, unit: x.unit, definition: x.definition, ...cell };
}

export function column(key: string, def: DefKey): Column {
  const x = DEFS[def];
  return { key, label: x.label, unit: x.unit, definition: x.definition };
}

// A comparison table from the current and previous period's rows. Rows are matched
// by key; a key only in the previous period still gets a row (current values 0/null),
// so a channel that dried up doesn't silently disappear. Sorted by the first column.
export function table<K>(
  columns: Column[],
  cur: Row[],
  prev: Row[],
  keyOf: (r: Row) => string,
  build: (c: Row, p: Row, first: Row) => TableRow<K>,
): Table<K> {
  const c = new Map(cur.map((r) => [keyOf(r), r]));
  const pr = new Map(prev.map((r) => [keyOf(r), r]));
  const keys = [...c.keys(), ...[...pr.keys()].filter((k) => !c.has(k))];
  const rows = keys.map((k) => build(c.get(k) ?? {}, pr.get(k) ?? {}, c.get(k) ?? pr.get(k) ?? {}));
  const first = columns[0]?.key;
  if (first) rows.sort((a, b) => (b.cells[first]?.value ?? -1) - (a.cells[first]?.value ?? -1));
  return { columns, rows };
}
