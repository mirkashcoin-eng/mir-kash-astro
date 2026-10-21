// HTML/SVG string builders shared by every section. No chart library: inline SVG only.
import type { Funnel, Metric, PeopleQuery, Series } from './types';
import { delta, esc, fmtDay, fmtValue, inrShort, num, SMALL_SAMPLE } from './format';

/** Hash link into the People view, filtered. Router in main.ts parses it. */
export function peopleHref(q?: PeopleQuery): string {
  const p = new URLSearchParams();
  if (q?.stage && q.stage !== 'all') p.set('stage', q.stage);
  if (q?.q) p.set('q', q.q);
  if (q?.source) p.set('source', q.source);
  if (q?.device) p.set('device', q.device);
  for (const k of Object.keys(q?.extra || {})) p.set(k, q!.extra![k]);
  const s = p.toString();
  return '#people' + (s ? '?' + s : '');
}

export function info(def: string): string {
  if (!def) return '';
  return '<button type="button" class="ad-i" data-def="' + esc(def) + '" aria-label="What this means: ' + esc(def) + '">i</button>';
}

export function panel(title: string, sub: string, body: string, opts: { id?: string; flush?: boolean; cls?: string } = {}): string {
  return '<section class="ad-panel ' + (opts.cls || '') + '"' + (opts.id ? ' id="' + opts.id + '"' : '') + '><div class="ad-panel__h"><h3 class="ad-panel__t">' + esc(title) + '</h3>' +
    (sub ? '<span class="ad-chart-sub">' + sub + '</span>' : '') + '</div><div class="' + (opts.flush ? 'ad-panel__flush' : 'ad-panel__body') + '">' + body + '</div></section>';
}

export function note(text: string, cls = ''): string { return '<p class="ad-note ' + cls + '">' + esc(text) + '</p>'; }
export function empty(title: string, text: string): string {
  return '<div class="ad-state"><strong>' + esc(title) + '</strong><span>' + esc(text) + '</span></div>';
}
export function notEnough(what = 'Not enough data in this range yet.'): string { return empty('Not enough data', what); }

// ── KPI card ─────────────────────────────────────────────────────────────────
export function kpiCard(m: Metric): string {
  const d = delta(m);
  const small = m.smallSample || (m.den != null && m.den < SMALL_SAMPLE && m.unit === 'pct');
  const valueHtml = m.value == null
    ? '<span class="ad-kpi__v ad-kpi__v--na">—</span>'
    : small
      ? '<span class="ad-kpi__v ad-kpi__v--small">Too few to judge</span>'
      : '<span class="ad-kpi__v">' + esc(fmtValue(m.value, m.unit)) + '</span>';
  const v = m.drill ? '<a class="ad-kpi__link" href="' + esc(peopleHref(m.drill)) + '" aria-label="' + esc(m.label + ': see the people behind this number') + '">' + valueHtml + '</a>' : valueHtml;
  const basis = m.num != null && m.den != null ? '<div class="ad-kpi__basis">' + num(m.num) + ' of ' + num(m.den) + (m.unit === 'pct' && basisNoun(m) ? ' ' + esc(basisNoun(m)) : '') + '.</div>' : '';
  const dl = d && !small ? '<div class="ad-kpi__delta ad-' + d.cls + '" aria-label="' + esc(d.label + ' compared with the previous period') + '"><span aria-hidden="true">' + d.arrow + '</span> ' + esc(d.text) + ' <span class="ad-mut">vs previous period</span></div>' : '<div class="ad-kpi__delta ad-kpi__delta--none">&nbsp;</div>';
  const goal = m.goal != null && m.value != null
    ? '<div class="ad-bar" role="img" aria-label="' + esc('Progress to goal: ' + Math.round((m.value / m.goal) * 100) + '%') + '"><i style="width:' + Math.min(100, Math.round((m.value / m.goal) * 100)) + '%"></i></div>' : '';
  return '<div class="ad-kpi"><div class="ad-kpi__k"><span>' + esc(m.label) + '</span>' + info(m.definition) + '</div>' + v + dl + basis +
    (m.note ? '<div class="ad-kpi__note">' + esc(m.note) + '</div>' : '') + goal + '</div>';
}
function basisNoun(m: Metric): string { return m.key === 'returning' || m.key === 'cartRate' ? 'visitors' : ''; }
export function kpiRow(ms: Metric[]): string { return '<div class="ad-kpis">' + ms.map(kpiCard).join('') + '</div>'; }

// ── Line chart (current solid, previous dotted) ──────────────────────────────
function niceCeil(v: number): number {
  if (v <= 0) return 1;
  const pow = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / pow;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * pow;
}
export function lineChart(s: Series, showPrev: boolean, label: string): string {
  const pts = s.points;
  if (pts.length < 2) return notEnough('Pick a longer range to see a trend.');
  const W = 600, H = 220, L = 8, R = 8, T = 18, B = 26;
  const pw = W - L - R, ph = H - T - B;
  const hasPrev = showPrev && pts.some((p) => p.prev != null);
  const vals = pts.flatMap((p) => [p.value, hasPrev && p.prev != null ? p.prev : 0]);
  const max = niceCeil(Math.max(...vals, 1));
  const x = (i: number) => L + (i / (pts.length - 1)) * pw;
  const y = (v: number) => T + ph - (v / max) * ph;
  const line = (get: (p: Series['points'][number]) => number | null | undefined) =>
    pts.map((p, i) => { const v = get(p); return v == null ? null : x(i).toFixed(1) + ',' + y(v).toFixed(1); }).filter(Boolean).join(' ');
  const fmt = (v: number) => (s.unit === 'inr' ? inrShort(v) : num(v));
  const grid = [0, 0.5, 1].map((f) => {
    const yy = T + ph - f * ph;
    return '<line x1="' + L + '" y1="' + yy.toFixed(1) + '" x2="' + (W - R) + '" y2="' + yy.toFixed(1) + '" class="ad-grid"/>' +
      (f > 0 ? '<text x="' + L + '" y="' + (yy - 4).toFixed(1) + '" class="ad-axis">' + esc(fmt(max * f)) + '</text>' : '');
  }).join('');
  const xl = [0, Math.floor((pts.length - 1) / 2), pts.length - 1].map((i, k) =>
    '<text x="' + x(i).toFixed(1) + '" y="' + (H - 8) + '" class="ad-axis" text-anchor="' + (k === 0 ? 'start' : k === 2 ? 'end' : 'middle') + '">' + esc(fmtDay(pts[i].day)) + '</text>').join('');
  const step = pw / (pts.length - 1);
  const hover = pts.map((p, i) =>
    '<rect x="' + (x(i) - step / 2).toFixed(1) + '" y="' + T + '" width="' + step.toFixed(1) + '" height="' + ph + '" fill="transparent"><title>' +
    esc(fmtDay(p.day) + ': ' + fmt(p.value) + (hasPrev && p.prev != null ? ' (previous period ' + fmt(p.prev) + ')' : '')) + '</title></rect>').join('');
  const total = pts.reduce((a, p) => a + p.value, 0);
  const aria = label + ' by day, ' + fmtDay(pts[0].day) + ' to ' + fmtDay(pts[pts.length - 1].day) + '. Total ' + fmt(total) + ', highest day ' + fmt(Math.max(...pts.map((p) => p.value))) + '.';
  return '<svg viewBox="0 0 ' + W + ' ' + H + '" class="ad-svg" role="img" aria-label="' + esc(aria) + '">' + grid +
    (hasPrev ? '<polyline fill="none" class="ad-line-prev" points="' + line((p) => p.prev) + '"/>' : '') +
    '<polyline fill="none" class="ad-line" points="' + line((p) => p.value) + '"/>' + xl + hover + '</svg>';
}

// ── Funnel (horizontal bars with drop-off) ───────────────────────────────────
export function funnelBars(f: Funnel, ariaLabel: string): string {
  const steps = f.steps || [];
  if (!steps.length || !steps[0].count) return notEnough('No visitors in this range yet.');
  const top = steps[0].count || 1;
  const rows = steps.map((s) => {
    const w = Math.max(1.5, (s.count / top) * 100);
    const right = num(s.count) + (s.ofPrev != null ? ' · ' + s.ofPrev + '%' : '');
    const name = s.drill ? '<a href="' + esc(peopleHref(s.drill)) + '">' + esc(s.label) + '</a>' : esc(s.label);
    return '<div class="ad-frow"><div class="ad-frow__top"><span>' + name + '</span><span class="ad-mut">' + esc(right) + '</span></div>' +
      '<div class="ad-bar"><i style="width:' + w.toFixed(1) + '%"></i></div></div>';
  }).join('');
  return '<div class="ad-funnel" role="group" aria-label="' + esc(ariaLabel) + '">' + rows + (f.leak ? '<p class="ad-note">' + esc(f.leak) + '</p>' : '') + '</div>';
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
const STACK_COLORS = ['#2c1a0e', '#1d5fa8', '#6e6a64', '#b4531a'];
export function stacked(parts: { label: string; value: number }[], ariaLabel: string): string {
  const total = parts.reduce((a, p) => a + p.value, 0);
  if (!total) return notEnough();
  const segs = parts.filter((p) => p.value > 0).map((p, i) => {
    const share = (p.value / total) * 100;
    const text = share >= 12 ? p.label + ' ' + Math.round(share) + '%' : '';
    return '<i style="flex:' + share.toFixed(2) + ';background:' + STACK_COLORS[i % STACK_COLORS.length] + '" title="' + esc(p.label + ' ' + Math.round(share) + '%') + '">' + esc(text) + '</i>';
  }).join('');
  return '<div class="ad-stack" role="img" aria-label="' + esc(ariaLabel + ': ' + parts.map((p) => p.label + ' ' + Math.round((p.value / total) * 100) + '%').join(', ')) + '">' + segs + '</div>';
}

// ── Cohort heatmap ───────────────────────────────────────────────────────────
export function heatmap(cohorts: { cohort: string; size: number; weeks: (number | null)[] }[]): string {
  if (!cohorts.length) return notEnough('Cohorts appear after a few weeks of visits.');
  const n = Math.max(...cohorts.map((c) => c.weeks.length));
  let head = '<tr><th scope="col">First visit</th><th scope="col" class="n">Visitors</th>';
  for (let w = 0; w < n; w++) head += '<th scope="col" class="n">' + (w === 0 ? 'Week 0' : 'Wk ' + w) + '</th>';
  head += '</tr>';
  const body = cohorts.map((c) => {
    let tds = '';
    for (let w = 0; w < n; w++) {
      const v = c.weeks[w];
      if (v == null) { tds += '<td class="n ad-heat ad-heat--na" aria-label="not yet">·</td>'; continue; }
      const a = Math.min(1, v / 40);
      const dark = a > 0.5;
      tds += '<td class="n ad-heat" style="background:rgba(44,26,14,' + (0.06 + a * 0.84).toFixed(2) + ');color:' + (dark ? '#fff' : '#141414') + '">' + v + '%</td>';
    }
    return '<tr><th scope="row">' + esc(c.cohort) + '</th><td class="n">' + num(c.size) + '</td>' + tds + '</tr>';
  }).join('');
  return '<div class="ad-scroll"><table class="ad-table ad-table--tight" aria-label="Share of each weekly cohort that came back, by weeks since first visit"><thead>' + head + '</thead><tbody>' + body + '</tbody></table></div>';
}

export function pill(text: string, tone: '' | 'blue' | 'orange' | 'dark' = ''): string {
  return '<span class="ad-chip' + (tone ? ' ad-chip--' + tone : '') + '">' + esc(text) + '</span>';
}
