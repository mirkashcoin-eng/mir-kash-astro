import type { Metric, Unit } from './types';

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

export function fmtValue(v: number | null, unit: Unit): string {
  if (v == null || !isFinite(v)) return '—';
  switch (unit) {
    case 'pct': return trim(v) + '%';
    case 'inr': return inrShort(v);
    case 'minutes': return v < 1 ? Math.round(v * 60) + ' sec' : trim(v) + ' min';
    case 'seconds': return v >= 90 ? trim(v / 60) + ' min' : Math.round(v) + ' sec';
    case 'days': return v < 1 ? 'Same day' : trim(v) + (Math.round(v) === 1 ? ' day' : ' days');
    case 'ratio': return trim(v) + '×';
    default: return num(v);
  }
}

export interface Delta { text: string; cls: 'up' | 'dn' | 'flat'; arrow: string; label: string; }
/** Change vs previous period. Rates compare in points, everything else in %. */
export function delta(m: Pick<Metric, 'value' | 'prev' | 'unit' | 'lowerIsBetter'>): Delta | null {
  if (m.value == null || m.prev == null || !isFinite(m.prev)) return null;
  let diff: number, text: string;
  if (m.unit === 'pct') {
    diff = m.value - m.prev;
    const d = Math.round(Math.abs(diff) * 10) / 10;
    text = d + ' pts';
    if (d === 0) return { text: 'no change', cls: 'flat', arrow: '–', label: 'No change' };
  } else {
    if (m.prev === 0) return m.value === 0 ? { text: 'no change', cls: 'flat', arrow: '–', label: 'No change' } : null;
    diff = m.value - m.prev;
    const d = Math.round(Math.abs(diff / m.prev) * 100);
    text = d + '%';
    if (d === 0) return { text: 'no change', cls: 'flat', arrow: '–', label: 'No change' };
  }
  const increased = diff > 0;
  const good = m.lowerIsBetter ? !increased : increased;
  return {
    text,
    cls: good ? 'up' : 'dn',
    arrow: increased ? '▲' : '▼',
    label: (increased ? 'Up ' : 'Down ') + text + (good ? ' (better)' : ' (worse)'),
  };
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
