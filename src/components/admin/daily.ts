// Daily funnel grid: one month at a time, one column per IST day, one row per number,
// from GET /api/admin/metrics/funnelDaily. Days from the old Firestore counters are
// flagged (legacy) and their missing numbers show as "not measured", never as 0.
import * as data from './data';
import type { Query } from './data';
import type { FunnelDailyResponse, FunnelDayRow } from './types';
import { info, notes } from './charts';
import { mount } from './views';
import { delta, esc, fmtValue, istToday } from './format';

let MONTH = '';          // 'YYYY-MM'
let BOTS = false;        // crawlers are recorded but left out unless switched on
let LAST: FunnelDailyResponse | null = null;

const $ = (id: string) => document.getElementById(id) as HTMLElement;
const pad = (n: number) => (n < 10 ? '0' : '') + n;
function monthRange(m: string): { from: string; to: string } {
  const y = Number(m.slice(0, 4)), mo = Number(m.slice(5, 7));
  const last = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  const end = m + '-' + pad(last);
  const today = istToday();
  return { from: m + '-01', to: end > today ? today : end };
}
function shift(delta: number) {
  const y = Number(MONTH.slice(0, 4)), mo = Number(MONTH.slice(5, 7)) - 1 + delta;
  const d = new Date(Date.UTC(y, mo, 1));
  MONTH = d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1);
}

function grid(r: FunnelDailyResponse, q: Query): string {
  const days = r.rows.slice().reverse();              // API is newest first; the grid reads left → right
  const totals = new Map(r.totals.map((m) => [m.key, m]));
  const head = '<tr><th scope="col" class="ad-daily__lab">Step</th>' + days.map((d) =>
    '<th scope="col" class="r' + (d.legacy ? ' ad-daily__legacy' : '') + '"' + (d.legacy ? ' title="Old counters (before the event log)"' : '') + '>' +
    Number(d.day.slice(8)) + (d.legacy ? '<span aria-label=" (old counters)">*</span>' : '') + '</th>').join('') +
    '<th scope="col" class="r ad-daily__tot">Total</th></tr>';
  const body = r.columns.map((c) => {
    const k = c.key as keyof FunnelDayRow;
    const cells = days.map((d) => {
      const v = d[k] as number | null;
      if (v == null) return '<td class="r ad-daily__z' + (d.legacy ? ' ad-daily__legacy' : '') + '" title="Not measured that day">–</td>';
      return '<td class="r' + (v ? '' : ' ad-daily__z') + (d.legacy ? ' ad-daily__legacy' : '') + '">' + (v ? esc(fmtValue(v, c.unit)) : '·') + '</td>';
    }).join('');
    const t = totals.get(c.key);
    let tot = '<td class="r ad-daily__tot ad-mut" title="Doesn’t add up across days: one person on 3 days counts 3 times">—</td>';
    if (t) {
      const dl = q.compare ? delta(t) : null;
      tot = '<td class="r ad-daily__tot">' + esc(fmtValue(t.value, t.unit)) +
        (dl && dl.cls !== 'flat' ? '<div class="ad-d ad-' + dl.cls + '" aria-label="' + esc(dl.label + ' vs the previous ' + r.period.days + ' days') + '"><span aria-hidden="true">' + dl.arrow + '</span>' + esc(dl.text) + '</div>' : '') + '</td>';
    }
    return '<tr><th scope="row" class="ad-daily__lab">' + esc(c.label) + ' ' + info(c.definition) + '</th>' + cells + tot + '</tr>';
  }).join('');
  return '<div class="ad-panel"><div class="ad-scroll"><table class="ad-table ad-daily" aria-label="Daily funnel by IST day"><thead>' + head + '</thead><tbody>' + body + '</tbody></table></div></div>';
}

function csv(r: FunnelDailyResponse) {
  const days = r.rows.slice().reverse();
  const lines = [['Step', ...days.map((d) => d.day + (d.legacy ? ' (old counters)' : ''))].join(',')];
  for (const c of r.columns) lines.push(['"' + c.label.replace(/"/g, '""') + '"', ...days.map((d) => { const v = d[c.key as keyof FunnelDayRow]; return v == null ? '' : String(v); })].join(','));
  const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'mir-kash-funnel-' + MONTH + '.csv';
  a.click();
  URL.revokeObjectURL(a.href);
}

export function renderDaily(q: Query) {
  if (!MONTH) MONTH = istToday().slice(0, 7);
  const pick = $('monthPick') as HTMLInputElement;
  if (pick && pick.value !== MONTH) pick.value = MONTH;
  pick.max = istToday().slice(0, 7);
  ($('monthNext') as HTMLButtonElement).disabled = MONTH >= istToday().slice(0, 7);
  const { from, to } = monthRange(MONTH);
  LAST = null;
  return mount($('dailyBody'), data.getFunnelDaily(q, from, to, BOTS), (r) => {
    LAST = r;
    return '<label class="ad-check"><input type="checkbox" id="dailyBots"' + (BOTS ? ' checked' : '') + ' /> Count crawlers too</label>' +
      grid(r, q) + (r.rows.some((d) => d.legacy) ? '<p class="ad-note">* Old counters, from before the event log. “–” means that number wasn’t measured that day.</p>' : '') +
      notes(r.notes);
  }, () => {
    const bots = document.getElementById('dailyBots');
    if (bots) bots.addEventListener('change', (e) => { BOTS = (e.target as HTMLInputElement).checked; renderDaily(q); });
  });
}

/** Month stepper, picker and CSV: bound once. `current` gives the latest query. */
export function bindDaily(current: () => Query) {
  $('monthPrev').addEventListener('click', () => { shift(-1); renderDaily(current()); });
  $('monthNext').addEventListener('click', () => { shift(1); renderDaily(current()); });
  $('monthPick').addEventListener('change', (e) => {
    const v = (e.target as HTMLInputElement).value;
    if (v) { MONTH = v; renderDaily(current()); }
  });
  $('monthCsv').addEventListener('click', () => { if (LAST) csv(LAST); });
}
