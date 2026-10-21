import type { Unit } from './types';

export const esc = (s: unknown): string =>
  String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' } as Record<string, string>)[c]);

export const SMALL_SAMPLE = 30;

const nf = new Intl.NumberFormat('en-IN');
export const num = (n: number | null | undefined): string => (n == null || !isFinite(n) ? '—' : nf.format(Math.round(n)));

export function inr(amount: number | string | null | undefined, cur = 'INR'): string {
  if (amount == null || amount === '') return '—';
  const n = Math.round(Number(amount));
  if (!isFinite(n)) return '—';
  try { return new Intl.NumberFormat('en-IN', { style: 'currency', currency: cur, maximumFractionDigits: 0 }).format(n); }
  catch { return cur + ' ' + n; }
}

/** ₹21.4L / ₹1.2Cr / ₹9,800 — for big KPI cards. */
export function inrShort(n: number | null | undefined): string {
  if (n == null || !isFinite(n)) return '—';
  const a = Math.abs(n);
  if (a >= 1e7) return '₹' + trim(n / 1e7) + 'Cr';
  if (a >= 1e5) return '₹' + trim(n / 1e5) + 'L';
  return inr(n);
}
function trim(v: number): string { return (Math.round(v * 10) / 10).toString(); }

/**
 * Format a number in the metrics API's units (src/lib/metrics/types.ts):
 * rate = fraction 0–1, pct = 0–100, ms = milliseconds, ratio = a multiple, inr = rupees.
 * `short` uses ₹21.4L style money (KPI cards); tables use full rupees.
 */
export function fmtValue(v: number | null | undefined, unit: Unit, short = true): string {
  if (v == null || !isFinite(v)) return '—';
  switch (unit) {
    case 'rate': return pctText(v * 100);
    case 'pct': return pctText(v);
    case 'inr': return short ? inrShort(v) : inr(v);
    case 'ms': return msText(v);
    case 'days': return v < 1 ? 'Same day' : trim(v) + (Math.round(v * 10) / 10 === 1 ? ' day' : ' days');
    case 'ratio': return trim(v) + '×';
    default: return Number.isInteger(v) || Math.abs(v) >= 100 ? num(v) : trim(v);
  }
}
function pctText(p: number): string {
  const a = Math.abs(p);
  return (a > 0 && a < 1 ? (Math.round(p * 10) / 10).toString() : a < 10 ? trim(p) : Math.round(p).toString()) + '%';
}
export function msText(ms: number): string {
  const s = ms / 1000;
  if (s < 60) return Math.round(s) + ' sec';
  const m = s / 60;
  if (m < 60) return (m < 10 ? trim(m) : Math.round(m).toString()) + ' min';
  return trim(m / 60) + ' h';
}

// Numbers where a fall is the good direction.
const LOWER_IS_BETTER = new Set([
  'otpFailureRate', 'paymentFailureRate', 'rejectRate', 'botShare', 'daysWithoutPageViews',
  'medianDaysToFirstOrder', 'medianSessionsToFirstOrder', 'costPerSale',
]);

export interface Delta { text: string; cls: 'up' | 'dn' | 'flat'; arrow: string; label: string; }
/** Change vs the previous period. Rates compare in percentage points, everything else in %. */
export function delta(m: { key?: string; value: number | null; prev: number | null; unit: Unit; lowerIsBetter?: boolean }): Delta | null {
  if (m.value == null || m.prev == null || !isFinite(m.prev)) return null;
  const flat: Delta = { text: 'no change', cls: 'flat', arrow: '–', label: 'No change' };
  let diff: number, text: string;
  if (m.unit === 'rate' || m.unit === 'pct') {
    const k = m.unit === 'rate' ? 100 : 1;
    diff = (m.value - m.prev) * k;
    const d = Math.round(Math.abs(diff) * 10) / 10;
    if (d === 0) return flat;
    text = d + ' pts';
  } else {
    if (m.prev === 0) return m.value === 0 ? flat : null;
    diff = m.value - m.prev;
    const d = Math.round(Math.abs(diff / m.prev) * 100);
    if (d === 0) return flat;
    text = d + '%';
  }
  const increased = diff > 0;
  const lower = m.lowerIsBetter ?? (m.key ? LOWER_IS_BETTER.has(m.key) : false);
  const good = lower ? !increased : increased;
  return { text, cls: good ? 'up' : 'dn', arrow: increased ? '▲' : '▼', label: (increased ? 'Up ' : 'Down ') + text + (good ? ' (better)' : ' (worse)') };
}

export const pct = (n: number, d: number): number => (d ? Math.round((n / d) * 100) : 0);
export const pct1 = (n: number, d: number): string => (d ? (Math.round((n / d) * 1000) / 10) + '%' : '—');

// ── IST dates ────────────────────────────────────────────────────────────────
export const istDay = (ts?: number | string | Date | null): string => {
  if (ts == null || ts === '') return '';
  const t = new Date(ts).getTime();
  if (!isFinite(t) || !t) return '';
  return new Date(t).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
};
export const istToday = (): string => istDay(Date.now());
/** Add days to a YYYY-MM-DD string (calendar arithmetic, no timezone drift). */
export function addDays(day: string, n: number): string {
  const d = new Date(day + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export const daysBetween = (a: string, b: string): number =>
  Math.round((new Date(b + 'T00:00:00Z').getTime() - new Date(a + 'T00:00:00Z').getTime()) / 864e5);

export function fmtDay(day: string, withYear = false): string {
  if (!day) return '';
  try {
    return new Date(day + 'T00:00:00Z').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', ...(withYear ? { year: 'numeric' } : {}), timeZone: 'UTC' });
  } catch { return day; }
}
export function fmtLongDay(day: string): string {
  try { return new Date(day + 'T00:00:00Z').toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }); }
  catch { return day; }
}
export function when(iso?: string | null, withTime = false): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString('en-IN', withTime
      ? { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' }
      : { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' });
  } catch { return String(iso); }
}
