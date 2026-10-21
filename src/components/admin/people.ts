// People: searchable list + detail drawer with the journey timeline.
import * as data from './data';
import type { Query } from './data';
import type { PeopleQuery, PersonDetail, PersonRow, Stage } from './types';
import { esc, inr, num } from './format';
import { mount, LOADING } from './views';
import { empty } from './charts';

const STAGE_LABEL: Record<string, string> = {
  visited: 'Visited', viewed: 'Viewed', cart: 'Cart', phone: 'Gave phone', address: 'Address', payment: 'Payment', ordered: 'Ordered',
};
const CHIPS: { key: string; label: string }[] = [
  { key: 'all', label: 'Everyone' }, { key: 'returning', label: 'Returning' }, { key: 'cart', label: 'Cart' },
  { key: 'phone', label: 'Gave phone' }, { key: 'payment', label: 'Payment' }, { key: 'ordered', label: 'Ordered' },
];

export interface PeopleState { pq: PeopleQuery; }
export const peopleState: PeopleState = { pq: { stage: 'all', page: 1 } };

export function setPeopleQueryFromHash(search: string) {
  const p = new URLSearchParams(search);
  peopleState.pq = {
    stage: ((p.get('stage') as Stage) || 'all'),
    q: p.get('q') || undefined, source: p.get('source') || undefined, device: p.get('device') || undefined, page: 1,
  };
}

function row(r: PersonRow): string {
  const name = r.name || 'Visitor';
  return '<tr><td><button type="button" class="ad-linkbtn ad-linkbtn--strong" data-open="' + esc(r.id) + '">' + esc(name) + '</button><div class="sub">' + esc([r.location, r.contact].filter(Boolean).join(' · ')) + '</div></td>' +
    '<td><span class="ad-chip">' + esc(STAGE_LABEL[r.stage] || r.stage) + '</span></td>' +
    '<td>' + num(r.visits) + (r.returning ? ' <span class="ad-chip ad-chip--blue">Returning</span>' : '') + '</td>' +
    '<td>' + esc(r.source || '—') + '</td><td>' + esc(r.device || '—') + '</td>' +
    '<td>' + (r.timeOnSiteMin != null ? esc(r.timeOnSiteMin < 1 ? 'under 1 min' : Math.round(r.timeOnSiteMin) + ' min') : '—') + '</td>' +
    '<td class="r">' + (r.cartValue ? esc(inr(r.cartValue)) : '·') + '</td>' +
    '<td class="r">' + (r.ordered ? '<span class="ad-mut">Bought</span>' : r.score != null ? '<strong>' + r.score + '</strong>' : '·') + '</td></tr>';
}

export function renderPeople(el: HTMLElement, q: Query, openPerson: (id: string) => void) {
  const pq = peopleState.pq;
  el.innerHTML = '<form class="ad-pfilters" role="search" id="pForm">' +
    '<label class="ad-sr" for="pSearch">Search people</label><input class="ad-input ad-input--search" id="pSearch" type="search" placeholder="Search name, phone, email, bag or source" value="' + esc(pq.q || '') + '" autocomplete="off">' +
    '<label class="ad-sr" for="pDevice">Device</label><select class="ad-input" id="pDevice"><option value="">All devices</option>' + ['Mobile', 'Desktop', 'Tablet'].map((d) => '<option' + (pq.device === d ? ' selected' : '') + '>' + d + '</option>').join('') + '</select>' +
    '<label class="ad-sr" for="pSource">Source contains</label><input class="ad-input" id="pSource" type="text" placeholder="Any source" value="' + esc(pq.source || '') + '" autocomplete="off">' +
    '<button class="ad-btn" type="submit">Search</button></form>' +
    '<div class="ad-chips" role="group" aria-label="Stage">' + CHIPS.map((c) => '<button type="button" class="ad-chipbtn' + ((pq.stage || 'all') === c.key ? ' on' : '') + '" aria-pressed="' + ((pq.stage || 'all') === c.key) + '" data-stage="' + c.key + '">' + c.label + '</button>').join('') + '</div>' +
    '<div id="pBody">' + LOADING + '</div>';
  const body = el.querySelector('#pBody') as HTMLElement;
  const reload = () => renderPeople(el, q, openPerson);
  (el.querySelector('#pForm') as HTMLFormElement).addEventListener('submit', (e) => {
    e.preventDefault();
    peopleState.pq = {
      stage: pq.stage, page: 1,
      q: ((el.querySelector('#pSearch') as HTMLInputElement).value || '').trim() || undefined,
      device: (el.querySelector('#pDevice') as HTMLSelectElement).value || undefined,
      source: ((el.querySelector('#pSource') as HTMLInputElement).value || '').trim() || undefined,
    };
    reload();
  });
  el.querySelectorAll('[data-stage]').forEach((b) => b.addEventListener('click', () => {
    peopleState.pq = { ...pq, stage: (b as HTMLElement).getAttribute('data-stage') as Stage, page: 1 };
    reload();
  }));
  mount(body, data.getPeople(q, pq), (d) => {
    if (!d.rows.length) return '<div class="ad-panel">' + empty(d.total === 0 && !pq.q && (!pq.stage || pq.stage === 'all') ? 'No one here yet' : 'No one matches that', 'Try a wider date range or fewer filters. Visitors appear as they browse, add bags or enter a phone number.') + '</div>';
    const from = (d.page - 1) * d.pageSize + 1, to = from + d.rows.length - 1;
    return '<div class="ad-people-head ad-mut">' + num(d.total) + ' ' + (d.total === 1 ? 'person' : 'people') + ' · ' + num(d.returning) + ' returning</div>' +
      '<div class="ad-panel ad-panel--flush"><div class="ad-scroll"><table class="ad-table ad-table--nowrap"><thead><tr><th scope="col">Person</th><th scope="col">Stage</th><th scope="col">Visits</th><th scope="col">Source</th><th scope="col">Device</th><th scope="col">Time on site</th><th scope="col" class="r">Cart</th><th scope="col" class="r">Score</th></tr></thead><tbody>' +
      d.rows.map(row).join('') + '</tbody></table></div>' +
      '<div class="ad-pager"><span class="ad-mut">Showing ' + num(from) + '–' + num(to) + ' of ' + num(d.total) + '</span><span class="ad-pager__b"><button type="button" class="ad-btn ad-btn--ghost" data-page="-1"' + (d.page <= 1 ? ' disabled' : '') + '>Previous</button><button type="button" class="ad-btn" data-page="1"' + (to >= d.total ? ' disabled' : '') + '>Next</button></span></div></div>';
  }, () => {
    body.querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', () => openPerson((b as HTMLElement).getAttribute('data-open')!)));
    body.querySelectorAll('[data-page]').forEach((b) => b.addEventListener('click', () => {
      peopleState.pq = { ...pq, page: Math.max(1, (pq.page || 1) + Number((b as HTMLElement).getAttribute('data-page'))) };
      reload();
    }));
  });
}

export function personDrawer(p: PersonDetail): string {
  const r = p.row;
  const tel = (p.phone || '').replace(/[^0-9]/g, '');
  const acts: string[] = [];
  if (tel) acts.push('<a class="ad-btn" href="https://wa.me/' + tel + '" target="_blank" rel="noopener">WhatsApp</a>', '<a class="ad-btn ad-btn--ghost" href="tel:+' + tel + '">Call</a>');
  if (p.email) acts.push('<a class="ad-btn ad-btn--ghost" href="mailto:' + esc(p.email) + '">Email</a>');
  const secs = (p.sections || []).map((s) =>
    '<div class="ad-dsect"><h3 class="ad-dh3">' + esc(s.title) + '</h3>' +
    (s.rows ? '<dl class="ad-dfacts">' + s.rows.map((f) => '<div><dt>' + esc(f[0]) + '</dt><dd>' + esc(f[1]) + '</dd></div>').join('') + '</dl>' : '') +
    (s.text ? '<p class="ad-daddr">' + esc(s.text) + '</p>' : '') +
    (s.lines ? '<table class="ad-dtable"><tbody>' + s.lines.map((l) => '<tr><td class="nm">' + esc(l.title) + (l.sub ? '<div class="sub">' + esc(l.sub) + '</div>' : '') + '</td><td class="r">' + esc(l.qty) + '</td><td class="r amt">' + esc(l.total) + '</td></tr>').join('') + '</tbody></table>' : '') + '</div>').join('');
  return '<div class="ad-dhead"><span class="ad-chip">' + esc(STAGE_LABEL[r.stage] || r.stage) + '</span>' + (r.score != null ? ' <span class="ad-chip">Score ' + r.score + '</span>' : '') +
    '<h2 class="ad-dtitle" id="drawerTitle">' + esc(r.name || 'Visitor') + '</h2>' +
    '<p class="ad-dmeta">' + esc([r.location, 'first seen ' + p.firstSeen, r.visits + (r.visits === 1 ? ' visit' : ' visits')].filter(Boolean).join(' · ')) + '</p>' +
    (p.summary ? '<p class="ad-dmeta">' + esc(p.summary) + '</p>' : '') + '</div>' +
    (acts.length ? '<div class="ad-dactions">' + acts.join('') + '</div>' : '') +
    '<dl class="ad-dfacts"><div><dt>First came from</dt><dd>' + esc(p.firstCame) + '</dd></div><div><dt>Last came from</dt><dd>' + esc(p.lastCame) + '</dd></div><div><dt>Device</dt><dd>' + esc(p.deviceLine) + '</dd></div><div><dt>Time on site</dt><dd>' + esc(p.timeOnSite) + '</dd></div></dl>' +
    secs + '<div class="ad-dsect"><h3 class="ad-dh3">Journey</h3>' +
    (p.timeline.length ? '<ol class="ad-tl">' + p.timeline.map((s) => '<li class="ad-tl__i"><span class="ad-tl__when">' + esc(s.at) + '</span><span class="ad-tl__what">' + esc(s.text) + '</span>' + (s.sub ? '<span class="ad-tl__d">' + esc(s.sub) + '</span>' : '') + '</li>').join('') + '</ol>' : '<p class="ad-note">No journey recorded yet.</p>') + '</div>';
}
