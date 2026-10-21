// HTML/SVG string builders shared by every section. No chart library: inline SVG only.
// Numbers arrive in the metrics API's shapes (Metric / Cell / Column / Table); every
// definition shown on hover is the API's own text.
import type { Cell, CohortRow, Column, FunnelStep, Metric, PeopleQuery, Series, Table } from './types';
import { delta, esc, fmtDay, fmtValue, num } from './format';

/** Hash link into the People view, filtered. Router in main.ts parses it. */
export function peopleHref(q?: PeopleQuery): string {
  const p = new URLSearchParams();
  if (q?.stage && q.stage !== 'all') p.set('stage', q.stage);
  if (q?.q) p.set('q', q.q);
  if (q?.source) p.set('source', q.source);
  if (q?.device) p.set('device', q.device);
  if (q?.city) p.set('city', q.city);
  const s = p.toString();
  return '#people' + (s ? '?' + s : '');
}

export function info(def: string): string {
  if (!def) return '';
  return '<button type="button" class="ad-i" data-def="' + esc(def) + '" aria-label="What this means: ' + esc(def) + '">i</button>';
}

export function panel(title: string, sub: string, body: string, opts: { id?: string; flush?: boolean; cls?: string; tools?: string } = {}): string {
  return '<section class="ad-panel ' + (opts.cls || '') + '"' + (opts.id ? ' id="' + opts.id + '"' : '') + '><div class="ad-panel__h"><h3 class="ad-panel__t">' + esc(title) + '</h3>' +
    (opts.tools || '') + (sub ? '<span class="ad-chart-sub">' + sub + '</span>' : '') + '</div><div class="' + (opts.flush ? 'ad-panel__flush' : 'ad-panel__body') + '">' + body + '</div></section>';
}

export function notes(list: string[] | undefined): string {
  return (list || []).map((n) => '<p class="ad-note">' + esc(n) + '</p>').join('');
}
export function empty(title: string, text: string): string {
  return '<div class="ad-state"><strong>' + esc(title) + '</strong><span>' + esc(text) + '</span></div>';
}
export function notEnough(what = 'Not enough data in this range yet.'): string { return empty('Not enough data', what); }

const isRate = (u: string) => u === 'rate';
/** "42 of 1,350" for rates, "from 64 orders" for medians. */
function basis(c: Cell, unit: string): string {
  if (c.num != null && c.den != null && isRate(unit)) return c.den > 0 ? num(c.num) + ' of ' + num(c.den) : 'none yet to measure';
  if (c.n != null) return c.n > 0 ? 'from ' + num(c.n) : 'none yet to measure';
  return '';
}

// ── KPI card ─────────────────────────────────────────────────────────────────
export interface KpiOpts { compare: boolean; drill?: PeopleQuery; note?: string; label?: string }
export function kpiCard(m: Metric, o: KpiOpts): string {
  const small = m.smallSample;
  const label = o.label || m.label;
  const valueHtml = m.value == null
    ? '<span class="ad-kpi__v ad-kpi__v--na">—</span>'
    : small
      ? '<span class="ad-kpi__v ad-kpi__v--small">Too few to judge</span>'
      : '<span class="ad-kpi__v">' + esc(fmtValue(m.value, m.unit)) + '</span>';
  const v = o.drill ? '<a class="ad-kpi__link" href="' + esc(peopleHref(o.drill)) + '" aria-label="' + esc(label + ': see the people behind this number') + '">' + valueHtml + '</a>' : valueHtml;
  const d = o.compare && !small ? delta(m) : null;
  const dl = d
    ? '<div class="ad-kpi__delta ad-' + d.cls + '" aria-label="' + esc(d.label + ' compared with the previous period') + '"><span aria-hidden="true">' + d.arrow + '</span> ' + esc(d.text) + ' <span class="ad-mut">vs previous period</span></div>'
    : '<div class="ad-kpi__delta ad-kpi__delta--none">&nbsp;</div>';
  const b = basis(m, m.unit);
  return '<div class="ad-kpi"><div class="ad-kpi__k"><span>' + esc(label) + '</span>' + info(m.definition) + '</div>' + v + dl +
    (b ? '<div class="ad-kpi__basis">' + esc(b) + (small && m.value != null ? ' · ' + esc(fmtValue(m.value, m.unit)) + ' so far' : '') + '</div>' : '') +
    (o.note ? '<div class="ad-kpi__note">' + esc(o.note) + '</div>' : '') + '</div>';
}
export function kpiRow(cards: string[]): string { return '<div class="ad-kpis">' + cards.join('') + '</div>'; }

// ── Line chart (gaps where a day wasn't measured) ────────────────────────────
function niceCeil(v: number): number {
  if (v <= 0) return 1;
  const pow = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / pow;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * pow;
}
export function lineChart(s: Series, label: string): string {
  const pts = s.points;
  if (pts.length < 2) return notEnough('Pick a range of at least two days to see a trend.');
  if (!pts.some((p) => p.value != null && p.value > 0)) return notEnough('Nothing to chart in this range.');
  const W = 600, H = 220, L = 8, R = 8, T = 18, B = 26;
  const pw = W - L - R, ph = H - T - B;
  const max = niceCeil(Math.max(...pts.map((p) => p.value ?? 0), 1));
  const x = (i: number) => L + (i / (pts.length - 1)) * pw;
  const y = (v: number) => T + ph - (v / max) * ph;
  // Break the line wherever a day has no number.
  const segs: string[] = [];
  let cur: string[] = [];
  pts.forEach((p, i) => {
    if (p.value == null) { if (cur.length) segs.push(cur.join(' ')); cur = []; return; }
    cur.push(x(i).toFixed(1) + ',' + y(p.value).toFixed(1));
  });
  if (cur.length) segs.push(cur.join(' '));
  const fmt = (v: number) => fmtValue(v, s.unit);
  const grid = [0, 0.5, 1].map((f) => {
    const yy = T + ph - f * ph;
    return '<line x1="' + L + '" y1="' + yy.toFixed(1) + '" x2="' + (W - R) + '" y2="' + yy.toFixed(1) + '" class="ad-grid"/>' +
      (f > 0 ? '<text x="' + L + '" y="' + (yy - 4).toFixed(1) + '" class="ad-axis">' + esc(fmt(max * f)) + '</text>' : '');
  }).join('');
  const xl = [0, Math.floor((pts.length - 1) / 2), pts.length - 1].map((i, k) =>
    '<text x="' + x(i).toFixed(1) + '" y="' + (H - 8) + '" class="ad-axis" text-anchor="' + (k === 0 ? 'start' : k === 2 ? 'end' : 'middle') + '">' + esc(fmtDay(pts[i].day)) + '</text>').join('');
  // Legacy days (old Firestore counters) get a light band so they read as "estimated".
  const step = pw / (pts.length - 1);
  const legacy = pts.map((p, i) => (p.legacy ? '<rect x="' + (x(i) - step / 2).toFixed(1) + '" y="' + T + '" width="' + step.toFixed(1) + '" height="' + ph + '" class="ad-legacyband"/>' : '')).join('');
  const hover = pts.map((p, i) =>
    '<rect x="' + (x(i) - step / 2).toFixed(1) + '" y="' + T + '" width="' + step.toFixed(1) + '" height="' + ph + '" fill="transparent"><title>' +
    esc(fmtDay(p.day) + ': ' + (p.value == null ? 'not measured' : fmt(p.value)) + (p.legacy ? ' (old counters)' : '')) + '</title></rect>').join('');
  const vals = pts.map((p) => p.value ?? 0);
  const total = vals.reduce((a, b) => a + b, 0);
  const aria = label + ' by day, ' + fmtDay(pts[0].day) + ' to ' + fmtDay(pts[pts.length - 1].day) + '. Total ' + fmt(total) + ', highest day ' + fmt(Math.max(...vals)) + '.';
  return '<svg viewBox="0 0 ' + W + ' ' + H + '" class="ad-svg" role="img" aria-label="' + esc(aria) + '">' + legacy + grid +
    segs.map((p) => '<polyline fill="none" class="ad-line" points="' + p + '"/>').join('') + xl + hover + '</svg>';
}

// ── Funnel (horizontal bars, share of the step before) ───────────────────────
export function funnelBars(steps: FunnelStep[], ariaLabel: string, drills: Record<string, PeopleQuery> = {}): string {
  if (!steps.length || !steps[0].value) return notEnough('No visitors in this range yet.');
  const top = steps[0].value || 1;
  let worst: { label: string; rate: number } | null = null;
  const rows = steps.map((s, i) => {
    const v = s.value ?? 0;
    const w = Math.max(1.5, (v / top) * 100);
    const fp = s.fromPrevious;
    const rate = fp && fp.value != null ? (fp.smallSample ? 'too few to judge' : fmtValue(fp.value, 'rate') + ' of ' + num(fp.den)) : '';
    if (fp && fp.value != null && !fp.smallSample && (!worst || fp.value < worst.rate)) worst = { label: steps[i - 1].label + ' → ' + s.label, rate: fp.value };
    const name = drills[s.key] ? '<a href="' + esc(peopleHref(drills[s.key])) + '">' + esc(s.label) + '</a>' : esc(s.label);
    return '<div class="ad-frow"><div class="ad-frow__top"><span>' + name + ' ' + info(s.definition + (fp ? ' The rate is ' + 'people at this step ÷ people at the step before.' : '')) + '</span><span class="ad-mut">' + esc(num(v) + (rate ? ' · ' + rate : '')) + '</span></div>' +
      '<div class="ad-bar"><i style="width:' + w.toFixed(1) + '%"></i></div></div>';
  }).join('');
  const w = worst as { label: string; rate: number } | null;
  const leak = w ? '<p class="ad-note">Biggest drop: ' + esc(w.label) + ' (' + esc(fmtValue(w.rate, 'rate')) + ' carry on).</p>' : '';
  return '<div class="ad-funnel" role="group" aria-label="' + esc(ariaLabel) + '">' + rows + leak + '</div>';
}

// ── API tables ───────────────────────────────────────────────────────────────
export interface TableOpts {
  compare: boolean;
  /** Columns to show, in order (default: all). */
  only?: string[];
  /** Column drawn as an inline bar (share of the largest row). */
  bar?: string;
  /** Link a row's label somewhere (e.g. People filtered by source). */
  href?: (row: Table<any>['rows'][number]) => string | null;
  firstHeader?: string;
  limit?: number;
  emptyText?: string;
}
function cellHtml(c: Cell | undefined, col: Column, compare: boolean): string {
  if (!c || c.value == null) return '<td class="r"><span class="ad-mut">—</span></td>';
  const small = c.smallSample && (isRate(col.unit) || c.n != null);
  const d = compare && !small ? delta({ key: col.key, value: c.value, prev: c.prev, unit: col.unit }) : null;
  const sub = [isRate(col.unit) && c.den ? num(c.num) + ' of ' + num(c.den) : '', small ? 'too few to judge' : ''].filter(Boolean).join(' · ');
  return '<td class="r"><span' + (small ? ' class="ad-mut"' : '') + '>' + esc(fmtValue(c.value, col.unit, false)) + '</span>' +
    (d && d.cls !== 'flat' ? ' <span class="ad-d ad-' + d.cls + '" aria-label="' + esc(d.label + ' vs previous period') + '"><span aria-hidden="true">' + d.arrow + '</span>' + esc(d.text) + '</span>' : '') +
    (sub ? '<div class="sub">' + esc(sub) + '</div>' : '') + '</td>';
}
export function apiTable(t: Table<any> | null | undefined, o: TableOpts): string {
  if (!t || !t.rows.length) return notEnough(o.emptyText || 'Nothing in this range yet.');
  const cols = o.only ? o.only.map((k) => t.columns.find((c) => c.key === k)).filter(Boolean) as Column[] : t.columns;
  const rows = o.limit ? t.rows.slice(0, o.limit) : t.rows;
  const barCol = o.bar ? t.columns.find((c) => c.key === o.bar) : null;
  const max = barCol ? Math.max(...rows.map((r) => r.cells[barCol.key]?.value ?? 0), 1) : 1;
  const head = '<tr><th scope="col">' + esc(o.firstHeader || '') + '</th>' + cols.map((c) =>
    '<th scope="col" class="r"><span class="ad-th">' + esc(c.label) + info(c.definition) + '</span></th>').join('') +
    (barCol ? '<th scope="col" class="ad-w120"><span class="ad-sr">Share</span></th>' : '') + '</tr>';
  const body = rows.map((r) => {
    const href = o.href ? o.href(r) : null;
    const bv = barCol ? r.cells[barCol.key]?.value ?? 0 : 0;
    return '<tr><th scope="row" class="nm">' + (href ? '<a href="' + esc(href) + '">' + esc(r.label) + '</a>' : esc(r.label)) + '</th>' +
      cols.map((c) => cellHtml(r.cells[c.key], c, o.compare)).join('') +
      (barCol ? '<td><div class="ad-bar" role="img" aria-label="' + esc(Math.round((bv / max) * 100) + '% of the largest row') + '"><i style="width:' + Math.max(1, Math.round((bv / max) * 100)) + '%"></i></div></td>' : '') + '</tr>';
  }).join('');
  return '<div class="ad-scroll"><table class="ad-table ad-table--api"><thead>' + head + '</thead><tbody>' + body + '</tbody></table></div>' +
    (o.limit && t.rows.length > o.limit ? '<p class="ad-note ad-pad">Showing the top ' + o.limit + ' of ' + t.rows.length + '.</p>' : '');
}

// ── Sorted horizontal bars ───────────────────────────────────────────────────
export interface BarRow { label: string; right: string; value: number; href?: string; blue?: boolean; }
export function hbars(rows: BarRow[], ariaLabel: string): string {
  if (!rows.length) return notEnough();
  const max = Math.max(...rows.map((r) => r.value), 1);
  return '<div class="ad-hbars" role="list" aria-label="' + esc(ariaLabel) + '">' + rows.map((r) =>
    '<div role="listitem"><div class="ad-l"><span>' + (r.href ? '<a href="' + esc(r.href) + '">' + esc(r.label) + '</a>' : esc(r.label)) + '</span><span class="ad-mut">' + esc(r.right) + '</span></div>' +
    '<div class="ad-bar' + (r.blue ? ' ad-bar--b' : '') + '"><i style="width:' + Math.max(1.5, (r.value / max) * 100).toFixed(1) + '%"></i></div></div>').join('') + '</div>';
}

// ── Stacked bar (audience mix; never a pie) ──────────────────────────────────
const STACK_COLORS = ['#2c1a0e', '#1d5fa8', '#6e6a64', '#b4531a', '#8a6a4f'];
export function stacked(parts: { label: string; value: number }[], ariaLabel: string): string {
  const total = parts.reduce((a, p) => a + p.value, 0);
  if (!total) return notEnough();
  const segs = parts.filter((p) => p.value > 0).map((p, i) => {
    const share = (p.value / total) * 100;
    const text = share >= 12 ? p.label + ' ' + Math.round(share) + '%' : '';
    return '<i style="flex:' + share.toFixed(2) + ';background:' + STACK_COLORS[i % STACK_COLORS.length] + '" title="' + esc(p.label + ' ' + Math.round(share) + '%') + '">' + esc(text) + '</i>';
  }).join('');
  const legend = parts.filter((p) => p.value > 0 && (p.value / total) * 100 < 12)
    .map((p) => esc(p.label) + ' ' + Math.round((p.value / total) * 100) + '%').join(' · ');
  return '<div class="ad-stack" role="img" aria-label="' + esc(ariaLabel + ': ' + parts.map((p) => p.label + ' ' + Math.round((p.value / total) * 100) + '%').join(', ')) + '">' + segs + '</div>' +
    (legend ? '<div class="ad-mut ad-small">' + legend + '</div>' : '');
}

// ── Cohort heatmap ───────────────────────────────────────────────────────────
export function heatmap(cohorts: CohortRow[], mode: 'active' | 'buyers', def: string): string {
  if (!cohorts.length) return notEnough('Cohorts appear once people have been visiting for a few weeks.');
  const n = Math.max(...cohorts.map((c) => c.weeks.length));
  const vals = cohorts.flatMap((c) => c.weeks.filter((w) => w.weeksSince > 0).map((w) => w[mode].value ?? 0));
  const top = Math.max(0.05, ...vals);
  let head = '<tr><th scope="col">First seen (week of)</th><th scope="col" class="r">People</th>';
  for (let w = 0; w < n; w++) head += '<th scope="col" class="r">' + (w === 0 ? 'Week 0' : 'Wk ' + w) + '</th>';
  head += '</tr>';
  const body = cohorts.map((c) => {
    let tds = '';
    for (let w = 0; w < n; w++) {
      const cell = c.weeks.find((x) => x.weeksSince === w)?.[mode];
      if (!cell || cell.value == null) { tds += '<td class="r ad-heat ad-heat--na"><span aria-label="not yet">·</span></td>'; continue; }
      const a = w === 0 && mode === 'active' ? 1 : Math.min(1, cell.value / top);
      const dark = a > 0.5;
      const label = fmtValue(cell.value, 'rate') + (cell.num != null ? ' (' + num(cell.num) + ' of ' + num(cell.den) + ')' : '');
      tds += '<td class="r ad-heat" title="' + esc(label) + '" style="background:rgba(44,26,14,' + (0.06 + a * 0.84).toFixed(2) + ');color:' + (dark ? '#fff' : '#141414') + '">' + esc(fmtValue(cell.value, 'rate')) + '</td>';
    }
    return '<tr><th scope="row">' + esc(fmtDay(c.cohortWeek, true)) + '</th><td class="r">' + num(c.size) + (c.size < 30 ? '<div class="sub">small</div>' : '') + '</td>' + tds + '</tr>';
  }).join('');
  return '<div class="ad-scroll"><table class="ad-table ad-table--tight" aria-label="' + esc(def) + '"><thead>' + head + '</thead><tbody>' + body + '</tbody></table></div>';
}
