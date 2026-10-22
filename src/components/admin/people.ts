// People: searchable list (GET /api/admin/people) + detail drawer with the journey
// timeline (GET ?id=). "Mark handled" posts to /api/admin/inbox as a hot_lead.
import * as data from './data';
import type { Query } from './data';
import type { PeopleList, PeopleQuery, PeopleSort, PersonDetail, PersonRow, ScoreView, Stage } from './types';
import { esc, inr, num } from './format';
import { mount, LOADING } from './views';
import { doneMenu, wireDone } from './inbox';
import { empty, term } from './charts';
import { DEFAULT_OUTCOMES, STAGE_LABEL, istDate, istWhen, outcomeLabel, productName } from './mapping';

const CHIPS: { key: string; label: string }[] = [
  { key: 'all', label: 'Everyone' }, { key: 'returning', label: 'Returning' }, { key: 'viewed', label: 'Viewed' },
  { key: 'cart', label: 'Cart' }, { key: 'checkout', label: 'Checkout' }, { key: 'phone', label: 'Gave phone' },
  { key: 'payment', label: 'Payment' }, { key: 'ordered', label: 'Ordered' },
];
const SORTS: { key: PeopleSort; label: string }[] = [
  { key: 'last_seen', label: 'Last seen' }, { key: 'score', label: 'Lead score' }, { key: 'cart', label: 'Cart value' },
  { key: 'value', label: 'Money spent' }, { key: 'visits', label: 'Visits' }, { key: 'first_seen', label: 'First seen' },
];

export interface PeopleState { pq: PeopleQuery; }
export const peopleState: PeopleState = { pq: { stage: 'all', page: 1 } };

export function setPeopleQueryFromHash(search: string) {
  const p = new URLSearchParams(search);
  peopleState.pq = {
    stage: ((p.get('stage') as Stage) || 'all'),
    q: p.get('q') || undefined, source: p.get('source') || undefined, device: p.get('device') || undefined,
    city: p.get('city') || undefined, sort: (p.get('sort') as PeopleSort) || undefined, page: 1,
  };
}

const minutes = (m: number | null) => (m == null ? '—' : m < 1 ? 'under 1 min' : Math.round(m) + ' min');

function row(r: PersonRow): string {
  const contact = [r.location, r.phone || r.email || (r.kind === 'visitor' ? 'no contact yet' : '')].filter(Boolean).join(' · ');
  return '<tr><td><button type="button" class="ad-linkbtn ad-linkbtn--strong" data-open="' + esc(r.id) + '">' + esc(r.name) + '</button>' +
    (r.isTest ? ' <span class="ad-chip">Test</span>' : '') + '<div class="sub">' + esc(contact) + '</div></td>' +
    '<td><span class="ad-chip">' + esc(STAGE_LABEL[r.stage]) + '</span></td>' +
    '<td>' + num(r.visits) + (r.returning ? ' <span class="ad-chip ad-chip--blue">Returning</span>' : '') + '</td>' +
    '<td>' + esc(r.source) + '</td><td>' + esc(r.device) + '</td>' +
    '<td>' + esc(minutes(r.timeOnSiteMin)) + '</td>' +
    '<td class="r">' + (r.cartValue ? esc(inr(r.cartValue, r.cartCurrency || 'INR')) : '·') + '</td>' +
    '<td class="r">' + (r.orders ? '<span class="ad-mut">Bought</span>' : r.score != null ? '<strong title="' + esc(r.reason) + '">' + r.score + '</strong>' : '·') + '</td></tr>';
}

// The eight steps in the order the stage is decided (see 004_people.sql). A person is
// counted once, at the furthest step we saw them reach, so the numbers add up.
const STEPS: Stage[] = ['visited', 'viewed', 'cart', 'checkout', 'phone', 'address', 'payment', 'ordered'];
function stepStrip(d: PeopleList, current: string): string {
  return '<div class="ad-panel ad-steps" role="group" aria-label="How far people got"><ol class="ad-steps__list">' + STEPS.map((s) =>
    '<li class="ad-step' + (current === s ? ' on' : '') + '"><span class="ad-step__n">' + num(d.stages?.[s] ?? 0) + '</span>' +
    '<span class="ad-step__l">' + esc(STAGE_LABEL[s]) + term('step:' + s) + '</span></li>').join('') + '</ol>' +
    '<p class="ad-note">Each person is counted once, at the furthest step we saw them reach. Use the buttons above to see who is at a step.</p></div>';
}

// "Why this score": the lines that add up to the number.
function scorePanel(sc: ScoreView | null): string {
  if (!sc) return '';
  const head = '<h3 class="ad-dh3">Why this score' + term('Why this score') + '</h3>';
  if (sc.notALead) return '<div class="ad-dsect">' + head + '<p class="ad-note">No score: ' + esc(sc.notALead.toLowerCase()) + '.</p></div>';
  const rows = sc.parts.map((x) =>
    '<tr><td>' + esc(x.label) + '<div class="ad-mut ad-small">' + esc(x.detail) + '</div></td>' +
    '<td class="r amt">' + x.points + ' <span class="ad-mut">of ' + x.max + '</span></td></tr>').join('');
  const fade = sc.fade ? '<tr><td>' + esc(sc.fade.note) + '</td><td class="r amt">× ' + sc.fade.factor + '</td></tr>' : '';
  return '<div class="ad-dsect">' + head + '<table class="ad-dtable ad-score"><tbody>' + rows + fade +
    '<tr class="ad-score__t"><td>Score</td><td class="r amt">' + (sc.score ?? '·') + ' <span class="ad-mut">of 100</span></td></tr></tbody></table></div>';
}

export function renderPeople(el: HTMLElement, q: Query, openPerson: (id: string) => void) {
  const pq = peopleState.pq;
  const stage = pq.stage || 'all';
  el.innerHTML = '<form class="ad-pfilters" role="search" id="pForm">' +
    '<label class="ad-sr" for="pSearch">Search people</label><input class="ad-input ad-input--search" id="pSearch" type="search" placeholder="Search name, phone, email, bag or source" value="' + esc(pq.q || '') + '" autocomplete="off">' +
    '<label class="ad-sr" for="pDevice">Device</label><select class="ad-input" id="pDevice"><option value="">All devices</option>' +
      [['mobile', 'Phone'], ['desktop', 'Desktop'], ['tablet', 'Tablet']].map(([v, l]) => '<option value="' + v + '"' + (pq.device === v ? ' selected' : '') + '>' + l + '</option>').join('') + '</select>' +
    '<label class="ad-sr" for="pSource">Source</label><input class="ad-input" id="pSource" type="text" placeholder="Source, e.g. instagram" value="' + esc(pq.source || '') + '" autocomplete="off">' +
    '<label class="ad-sr" for="pCity">City</label><input class="ad-input" id="pCity" type="text" placeholder="City" value="' + esc(pq.city || '') + '" autocomplete="off">' +
    '<label class="ad-sr" for="pSort">Sort by</label><select class="ad-input" id="pSort">' + SORTS.map((s) => '<option value="' + s.key + '"' + ((pq.sort || 'last_seen') === s.key ? ' selected' : '') + '>Sort: ' + s.label + '</option>').join('') + '</select>' +
    '<button class="ad-btn" type="submit">Search</button></form>' +
    '<div class="ad-chips" role="group" aria-label="Stage">' + CHIPS.map((c) => '<span class="ad-chipwrap"><button type="button" class="ad-chipbtn' + (stage === c.key ? ' on' : '') + '" aria-pressed="' + (stage === c.key) + '" data-stage="' + c.key + '">' + c.label + '</button>' + term(c.key === 'checkout' ? 'At checkout' : c.label) + '</span>').join('') + '</div>' +
    '<div id="pBody">' + LOADING + '</div>';
  const body = el.querySelector('#pBody') as HTMLElement;
  const reload = () => renderPeople(el, q, openPerson);
  const val = (id: string) => ((el.querySelector('#' + id) as HTMLInputElement).value || '').trim() || undefined;
  (el.querySelector('#pForm') as HTMLFormElement).addEventListener('submit', (e) => {
    e.preventDefault();
    peopleState.pq = { stage: pq.stage, page: 1, q: val('pSearch'), device: val('pDevice'), source: val('pSource'), city: val('pCity'), sort: val('pSort') as PeopleSort };
    reload();
  });
  (el.querySelector('#pSort') as HTMLSelectElement).addEventListener('change', () => {
    peopleState.pq = { ...pq, sort: val('pSort') as PeopleSort, page: 1 };
    reload();
  });
  el.querySelectorAll('[data-stage]').forEach((b) => b.addEventListener('click', () => {
    peopleState.pq = { ...pq, stage: (b as HTMLElement).getAttribute('data-stage') as Stage, page: 1 };
    reload();
  }));
  mount(body, data.getPeople(q, pq), (d) => {
    const head = stepStrip(d, stage) + '<div class="ad-people-head ad-mut">' + num(d.count) + ' of ' + num(d.total) + ' · ' + num(d.returning) + ' returning · active in the selected range' +
      (d.asOf ? ' · list as of ' + esc(istWhen(d.asOf).replace(/^(Today|Yesterday)/, (s) => s.toLowerCase())) : '') + '</div>';
    if (!d.rows.length) return head + '<div class="ad-panel">' + empty(d.total === 0 ? 'No one here yet' : 'No one matches that', 'Try a wider date range or fewer filters. People appear as they browse, add bags or enter a phone number.') + '</div>';
    const from = (d.page - 1) * d.size + 1, to = from + d.rows.length - 1;
    return head +
      '<div class="ad-panel ad-panel--flush"><div class="ad-scroll"><table class="ad-table ad-table--nowrap"><thead><tr><th scope="col">Person</th><th scope="col">Stage</th><th scope="col">Visits</th><th scope="col">First came from</th><th scope="col">Device</th><th scope="col">Time on site</th><th scope="col" class="r">Cart</th><th scope="col" class="r">Score</th></tr></thead><tbody>' +
      d.rows.map(row).join('') + '</tbody></table></div>' +
      '<div class="ad-pager"><span class="ad-mut">Showing ' + num(from) + '–' + num(to) + ' of ' + num(d.count) + '</span><span class="ad-pager__b"><button type="button" class="ad-btn ad-btn--ghost" data-page="-1"' + (d.page <= 1 ? ' disabled' : '') + '>Previous</button><button type="button" class="ad-btn" data-page="1"' + (d.page >= d.pages ? ' disabled' : '') + '>Next</button></span></div></div>';
  }, () => {
    body.querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', () => openPerson((b as HTMLElement).getAttribute('data-open')!)));
    body.querySelectorAll('[data-page]').forEach((b) => b.addEventListener('click', () => {
      peopleState.pq = { ...pq, page: Math.max(1, (pq.page || 1) + Number((b as HTMLElement).getAttribute('data-page'))) };
      reload();
    }));
  });
}

// ── Drawer ───────────────────────────────────────────────────────────────────
export function personDrawer(p: PersonDetail, outcomes: string[] = DEFAULT_OUTCOMES.hot_lead): string {
  const r = p.row;
  const tel = (p.phone || '').replace(/[^0-9]/g, '');
  const acts: string[] = [];
  if (p.whatsapp) acts.push('<a class="ad-btn" href="' + esc(p.whatsapp) + '" target="_blank" rel="noopener">WhatsApp</a>');
  if (tel) acts.push('<a class="ad-btn ad-btn--ghost" href="tel:+' + tel + '">Call</a>');
  if (p.email) acts.push('<a class="ad-btn ad-btn--ghost" href="mailto:' + esc(p.email) + '">Email</a>');
  // Handling is recorded against a person (an anonymous browser can't be contacted).
  const isPerson = !p.id.startsWith('v:');
  const handle = isPerson ? doneMenu('hot_lead', p.id, outcomes, 'Mark handled') : '';

  const facts: [string, string][] = [];
  if (r) {
    facts.push(['First came from', r.source], ['Last came from', r.lastSource], ['Device', r.device], ['Time on site', minutes(r.timeOnSiteMin) + ' total']);
    if (r.products.length) facts.push(['Bags looked at', r.products.map(productName).join(', ')]);
    if (r.cartValue) facts.push(['Latest cart', inr(r.cartValue, r.cartCurrency || 'INR')]);
    if (r.orders) facts.push(['Orders', r.orders + (r.orders > 1 ? ' · repeat buyer' : '') + (r.ltv ? ' · ' + inr(r.ltv) : '')]);
    if (r.daysToFirstPurchase != null) facts.push(['Time to first order', r.daysToFirstPurchase < 1 ? 'Same day' : Math.round(r.daysToFirstPurchase) + ' days']);
  }
  if (p.address) facts.push(['Address', p.address]);

  const handled = p.handled.length
    ? '<div class="ad-dsect"><h3 class="ad-dh3">Handled</h3><ul class="ad-handled">' + p.handled.map((a) =>
      '<li><strong>' + esc(outcomeLabel(a.outcome)) + '</strong> · ' + esc(istWhen(a.at)) + (a.by ? ' · ' + esc(a.by.split('@')[0]) : '') + (a.note ? '<div class="ad-mut ad-small">' + esc(a.note) + '</div>' : '') + '</li>').join('') + '</ul></div>'
    : '';

  const meta = [r?.location, p.firstSeen ? 'first seen ' + istDate(p.firstSeen) : '', p.counts.visits ? p.counts.visits + (p.counts.visits === 1 ? ' visit' : ' visits') : ''].filter(Boolean).join(' · ');
  return '<div class="ad-dhead">' + (r ? '<span class="ad-chip">' + esc(STAGE_LABEL[r.stage]) + '</span>' : '') + (r?.score != null ? ' <span class="ad-chip">Score ' + r.score + '</span>' : '') +
    '<h2 class="ad-dtitle" id="drawerTitle">' + esc(p.name) + '</h2>' +
    (meta ? '<p class="ad-dmeta">' + esc(meta) + '</p>' : '') +
    (r?.reason ? '<p class="ad-dmeta">' + esc(r.reason) + '</p>' : '') +
    [p.phone, p.email].filter(Boolean).map((c) => '<p class="ad-dmeta">' + esc(c) + '</p>').join('') + '</div>' +
    (acts.length || handle ? '<div class="ad-dactions">' + acts.join('') + handle + '</div><p class="ad-irow__msg ad-small" role="status" data-drawer-msg></p>' : '') +
    (facts.length ? '<dl class="ad-dfacts">' + facts.map((f) => '<div><dt>' + esc(f[0]) + '</dt><dd>' + esc(f[1]) + '</dd></div>').join('') + '</dl>' : '') +
    scorePanel(p.score) +
    handled +
    '<div class="ad-dsect"><h3 class="ad-dh3">Journey · newest first</h3>' +
    (p.timeline.length ? '<ol class="ad-tl">' + p.timeline.map((s) => '<li class="ad-tl__i ad-tl__i--' + s.kind + '"><span class="ad-tl__when">' + esc(s.at) + '</span><span class="ad-tl__what">' + esc(s.text) + '</span>' + (s.sub ? '<span class="ad-tl__d">' + esc(s.sub) + '</span>' : '') + '</li>').join('') + '</ol>' : '<p class="ad-note">No journey recorded yet.</p>') + '</div>';
}

/** Wire "Mark handled" inside the drawer. */
export function wireDrawer(root: HTMLElement, onHandled: (ref: string) => void) {
  wireDone(root, (btn, outcome) => {
    const msg = root.querySelector('[data-drawer-msg]') as HTMLElement | null;
    const det = root.querySelector('.ad-done') as HTMLDetailsElement | null;
    if (det) det.open = false;
    if (msg) msg.textContent = 'Marked ' + outcomeLabel(outcome).toLowerCase() + '. They’ll leave Do today for a week.';
    onHandled(btn.getAttribute('data-ref') || '');
  });
}
