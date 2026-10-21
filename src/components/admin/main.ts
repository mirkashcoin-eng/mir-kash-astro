// Entry point for /admin: sign-in gate, role handling, hash router, global controls
// (date range, compare, test records), tracking-health pill. Data loads once per view
// per page load; nothing polls (Firestore quota — see admin-no-polling).
import { getIdToken, getSessionUser, signInWithGoogle, signOut } from '~/lib/firebaseClient';
import * as data from './data';
import type { Query } from './data';
import { initOps } from './ops';
import * as views from './views';
import { peopleState, personDrawer, renderPeople, setPeopleQueryFromHash } from './people';
import { addDays, esc, fmtDay, fmtLongDay, istToday } from './format';
import { info } from './charts';
import type { TrackingHealth } from './types';

const $ = (id: string) => document.getElementById(id) as HTMLElement;

interface ViewDef { title: string; sub: string; range: boolean; group: 'act' | 'understand' | 'ops'; }
const VIEWS: Record<string, ViewDef> = {
  today: { title: 'Today', sub: '', range: true, group: 'act' },
  overview: { title: 'Overview', sub: 'How the shop is doing, compared with the period before.', range: true, group: 'understand' },
  acquisition: { title: 'Acquisition', sub: 'Which channels and campaigns bring buyers, not just visitors.', range: true, group: 'understand' },
  products: { title: 'Products', sub: 'Which bags get attention, and which of them sell.', range: true, group: 'understand' },
  checkout: { title: 'Checkout', sub: 'Where checkout loses people and money.', range: true, group: 'understand' },
  audience: { title: 'Audience', sub: 'Who visits, who buys, and what they use.', range: true, group: 'understand' },
  retention: { title: 'Retention', sub: 'Whether people come back and buy again.', range: true, group: 'understand' },
  people: { title: 'People', sub: 'Everyone, no cap. Open anyone for their full journey.', range: true, group: 'understand' },
  daily: { title: 'Daily funnel', sub: 'One month at a time. Each column is a day (IST); each row counts the people who reached that step.', range: false, group: 'understand' },
  orders: { title: 'Orders & revenue', sub: '', range: false, group: 'ops' },
  fulfilment: { title: 'Fulfilment & payments', sub: '', range: false, group: 'ops' },
  demos: { title: 'Try at Home bookings', sub: '', range: false, group: 'ops' },
  viewings: { title: 'Private Viewing bookings', sub: '', range: false, group: 'ops' },
  affiliates: { title: 'Affiliates', sub: 'Give a creator their own link. Any India order that starts from it is credited to them.', range: false, group: 'ops' },
  newsletter: { title: 'Newsletter', sub: 'Everyone who signed up from the site footer. Stored here even when Shopify sync is unavailable.', range: false, group: 'ops' },
  team: { title: 'Team access', sub: 'Grant someone else access to this dashboard. "Full" sees everything; "Affiliate links only" sees just the Affiliates view.', range: false, group: 'ops' },
};

const state = {
  view: 'today',
  preset: '30d' as 'today' | '7d' | '30d' | 'custom',
  from: addDays(istToday(), -29),
  to: istToday(),
  compare: true,
  test: false,
  role: null as null | 'full' | 'affiliate',
};
const rendered: Record<string, string> = {};
const query = (): Query => ({ from: state.from, to: state.to, compare: state.compare, bots: false, test: state.test });
const qKey = () => [state.from, state.to, state.compare, state.test].join('|');

let ops: ReturnType<typeof initOps>;

function rangeLabel(): string {
  if (state.preset === 'today') return 'today';
  if (state.preset === '7d') return 'last 7 days';
  if (state.preset === '30d') return 'last 30 days';
  return fmtDay(state.from, true) + ' to ' + fmtDay(state.to, true);
}

// ── Router ───────────────────────────────────────────────────────────────────
function parseHash(): { view: string; search: string } {
  const h = (location.hash || '').replace(/^#/, '');
  const [v, s] = h.split('?');
  return { view: v && VIEWS[v] ? v : 'today', search: s || '' };
}
function go(view: string) { location.hash = view; }

function allowed(view: string): boolean {
  if (state.role === 'affiliate') return view === 'affiliates';
  if (view === 'team') return state.role === 'full';
  return true;
}

function route() {
  const { view: want, search } = parseHash();
  const view = allowed(want) ? want : state.role === 'affiliate' ? 'affiliates' : 'today';
  if (want === 'people') { setPeopleQueryFromHash(search); delete rendered.people; }
  state.view = view;
  document.querySelectorAll<HTMLElement>('[data-nav]').forEach((a) => {
    const on = a.getAttribute('data-nav') === view;
    a.classList.toggle('on', on);
    if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  document.querySelectorAll<HTMLElement>('[data-section]').forEach((s) => { s.hidden = s.getAttribute('data-section') !== view; });
  const def = VIEWS[view];
  $('viewTitle').textContent = def.title;
  document.title = def.title + ' · Mir Kash Admin';
  $('viewSub').textContent = view === 'today' ? fmtLongDay(istToday()) + ' · what needs you, then how the shop is doing' : def.sub;
  $('rangeControls').hidden = !def.range;
  $('healthWrap').hidden = !def.range;
  $('shell').classList.remove('nav-open');
  $('navToggle').setAttribute('aria-expanded', 'false');
  window.scrollTo(0, 0);
  if (def.group === 'ops' || view === 'people' || view === 'daily') ops.markSeen(view);
  paint(view);
}

function paint(view: string) {
  if (!VIEWS[view].range) { if (view === 'daily') ops.renderDaily(); return; }
  const key = qKey() + (view === 'people' ? '|' + JSON.stringify(peopleState.pq) : '');
  if (rendered[view] === key) return;
  rendered[view] = key;
  const q = query();
  const el = (id: string) => $(id);
  if (view === 'today') {
    $('todayKpiTitle').textContent = 'The shop, ' + rangeLabel();
    views.renderInbox(el('inboxBody'), openPerson).then(() => { $('inboxCount').textContent = views.inboxCount(el('inboxBody')) + ' things · each one tap'; });
    views.renderOverview(el('todayOverview'), q, { all: false });
  } else if (view === 'overview') views.renderOverview(el('overviewBody'), q, { all: true });
  else if (view === 'acquisition') views.renderAcquisition(el('acquisitionBody'), q);
  else if (view === 'products') views.renderProducts(el('productsBody'), q);
  else if (view === 'checkout') views.renderCheckout(el('checkoutBody'), q);
  else if (view === 'audience') views.renderAudience(el('audienceBody'), q);
  else if (view === 'retention') views.renderRetention(el('retentionBody'), q);
  else if (view === 'people') renderPeople(el('peopleRoot'), q, openPerson);
}

function invalidate() {
  for (const k of Object.keys(rendered)) delete rendered[k];
  updateRangeUi();
  paint(state.view);
  loadHealth();
}

// ── Person drawer (new People API) ───────────────────────────────────────────
async function openPerson(id: string) {
  if (id.indexOf('legacy:') === 0) { ops.openLegacyPerson(id.slice(7)); return; }
  ops.openDrawerHtml('<div class="ad-state ad-state--load" role="status"><span class="ad-spin" aria-hidden="true"></span> Loading…</div>');
  const r = await data.getPerson(id, query());
  if (!ops.drawerOpen()) return;
  ops.setDrawerHtml(r.ok ? personDrawer(r.data) : '<div class="ad-state ad-state--err" role="alert"><strong>Couldn’t load this person</strong><span>' + esc(r.error) + '</span></div>');
}

// ── Controls ─────────────────────────────────────────────────────────────────
function updateRangeUi() {
  document.querySelectorAll<HTMLElement>('[data-preset]').forEach((b) => {
    const on = b.getAttribute('data-preset') === state.preset;
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', String(on));
  });
  $('customRange').hidden = state.preset !== 'custom';
  ($('dateFrom') as HTMLInputElement).value = state.from;
  ($('dateTo') as HTMLInputElement).value = state.to;
  $('rangeText').textContent = fmtDay(state.from, true) + (state.from === state.to ? '' : ' to ' + fmtDay(state.to, true)) + ' · IST';
}
function setPreset(p: typeof state.preset) {
  state.preset = p;
  const t = istToday();
  if (p === 'today') { state.from = t; state.to = t; }
  else if (p === '7d') { state.from = addDays(t, -6); state.to = t; }
  else if (p === '30d') { state.from = addDays(t, -29); state.to = t; }
  if (p !== 'custom') invalidate(); else updateRangeUi();
}

let HEALTH_KEY = '';
async function loadHealth() {
  if (!VIEWS[state.view].range) return;
  const key = state.to + '|' + state.test;
  if (key === HEALTH_KEY) return;
  HEALTH_KEY = key;
  const h = await data.getHealth(query());
  paintHealth(h);
}
function paintHealth(h: TrackingHealth) {
  const btn = $('healthBtn');
  btn.className = 'ad-health ad-health--' + h.status;
  btn.innerHTML = '<span aria-hidden="true">' + (h.status === 'healthy' ? '●' : h.status === 'unknown' ? '○' : '▲') + '</span> ' + esc(h.label);
  $('healthPanel').innerHTML = h.checks.length
    ? '<ul class="ad-checks">' + h.checks.map((c) => '<li><strong>' + (c.ok ? 'OK' : 'Check') + ': ' + esc(c.label) + '</strong><span class="ad-mut">' + esc(c.detail) + '</span></li>').join('') + '</ul>'
    : '<p class="ad-note">No health checks reported yet.</p>';
}

function bindControls() {
  document.querySelectorAll<HTMLElement>('[data-preset]').forEach((b) => b.addEventListener('click', () => setPreset(b.getAttribute('data-preset') as typeof state.preset)));
  const onCustom = () => {
    const f = ($('dateFrom') as HTMLInputElement).value, t = ($('dateTo') as HTMLInputElement).value;
    if (!f || !t || f > t) return;
    state.from = f; state.to = t; invalidate();
  };
  $('dateFrom').addEventListener('change', onCustom);
  $('dateTo').addEventListener('change', onCustom);
  ($('compare') as HTMLInputElement).addEventListener('change', (e) => { state.compare = (e.target as HTMLInputElement).checked; invalidate(); });
  ($('showHidden') as HTMLInputElement).addEventListener('change', (e) => {
    state.test = (e.target as HTMLInputElement).checked;
    ops.setShowHidden(state.test); ops.rerender();
    HEALTH_KEY = ''; invalidate();
  });
  $('healthBtn').addEventListener('click', () => {
    const open = $('healthPanel').hidden;
    $('healthPanel').hidden = !open;
    $('healthBtn').setAttribute('aria-expanded', String(open));
  });
  $('navToggle').addEventListener('click', () => {
    const open = !$('shell').classList.contains('nav-open');
    $('shell').classList.toggle('nav-open', open);
    $('navToggle').setAttribute('aria-expanded', String(open));
  });
  document.querySelectorAll<HTMLElement>('[data-nav]').forEach((a) => a.addEventListener('click', () => { $('shell').classList.remove('nav-open'); }));
  // Retry buttons inside any section re-run that view.
  document.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    if (t.closest('[data-retry]')) { data.clearCache(); invalidate(); }
  });
  $('lockBtn').addEventListener('click', async () => {
    try { await signOut(); } catch { /* already out */ }
    location.reload();
  });
  window.addEventListener('hashchange', route);
  bindTooltips();
}

// Definitions: shown on hover, keyboard focus, and tap.
function bindTooltips() {
  const tip = $('tip');
  let current: HTMLElement | null = null;
  const show = (el: HTMLElement) => {
    const def = el.getAttribute('data-def'); if (!def) return;
    current = el;
    tip.textContent = def; tip.hidden = false;
    const r = el.getBoundingClientRect();
    const w = Math.min(280, window.innerWidth - 24);
    tip.style.width = w + 'px';
    tip.style.left = Math.max(12, Math.min(window.innerWidth - w - 12, r.left + r.width / 2 - w / 2)) + 'px';
    tip.style.top = (r.bottom + 8 + window.scrollY) + 'px';
    el.setAttribute('aria-describedby', 'tip');
  };
  const hide = () => { tip.hidden = true; if (current) current.removeAttribute('aria-describedby'); current = null; };
  document.addEventListener('mouseover', (e) => { const el = (e.target as HTMLElement).closest('.ad-i') as HTMLElement | null; if (el) show(el); });
  document.addEventListener('mouseout', (e) => { if ((e.target as HTMLElement).closest('.ad-i')) hide(); });
  document.addEventListener('focusin', (e) => { const el = (e.target as HTMLElement).closest('.ad-i') as HTMLElement | null; if (el) show(el); });
  document.addEventListener('focusout', (e) => { if ((e.target as HTMLElement).closest('.ad-i')) hide(); });
  document.addEventListener('click', (e) => {
    const el = (e.target as HTMLElement).closest('.ad-i') as HTMLElement | null;
    if (el) { if (current === el && !tip.hidden) hide(); else show(el); } else hide();
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hide(); });
}

// ── Boot ─────────────────────────────────────────────────────────────────────
function showShell(role: 'full' | 'affiliate') {
  state.role = role;
  $('gate').hidden = true;
  $('shell').hidden = false;
  document.body.classList.add(role === 'full' ? 'ad-role-full' : 'ad-role-affiliate');
  if (data.DEMO) $('demoBanner').hidden = false;
  updateRangeUi();
  if (role === 'affiliate' && parseHash().view !== 'affiliates') history.replaceState(null, '', '#affiliates');
  route();
  loadHealth();
}

async function loadDashboard(headers: Record<string, string>): Promise<boolean> {
  const r = await data.callData(headers);
  if (r.data) { ops.renderOps(r.data); showShell('full'); ops.loadTeam(); return true; }
  if (r.status === 401) {
    const ar = await data.callAffiliates(headers);
    if (ar.data) { ops.renderAffiliateOnly(ar.data.affiliates); showShell('affiliate'); return true; }
  }
  return false;
}

const setStatus = (m: string) => { $('signinStatus').textContent = m || ''; };

async function boot() {
  ops = initOps();
  bindControls();
  // Dev-only preview: ?demo=1 on the dev server renders the whole shell with sample data and
  // no sign-in. import.meta.env.DEV is false in production builds, so the gate is unchanged there.
  if (data.DEMO_SKIPS_AUTH) { ops.renderOps(data.demoLegacy()); showShell('full'); return; }
  $('gate').hidden = false;
  const gbtn = $('googleBtn') as HTMLButtonElement;
  gbtn.disabled = true;
  setStatus('Checking your session…');
  try {
    const user = await getSessionUser();
    if (user) {
      const token = await getIdToken();
      if (token && (await loadDashboard({ Authorization: 'Bearer ' + token }))) { setStatus(''); return; }
    }
  } catch { /* fall through to the gate */ }
  setStatus('');
  gbtn.disabled = false;
}

$('googleBtn').addEventListener('click', async () => {
  const btn = $('googleBtn') as HTMLButtonElement;
  btn.disabled = true;
  setStatus('Opening Google…');
  try {
    const user = await signInWithGoogle();
    if (!user) { setStatus('Google sign-in is unavailable — please try again.'); btn.disabled = false; return; }
    setStatus('Signing in…');
    const token = await getIdToken(true);
    if (await loadDashboard({ Authorization: 'Bearer ' + token })) return;
    setStatus('That Google account isn’t an admin.');
    await signOut().catch(() => {});
    btn.disabled = false;
  } catch (err: any) {
    const code = (err && err.code) || '';
    if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') setStatus('Sign-in cancelled.');
    else if (code === 'auth/unauthorized-domain') setStatus('This domain isn’t authorised in Firebase yet.');
    else setStatus('Sign-in failed' + (code ? ' (' + code + ')' : '') + '.');
    btn.disabled = false;
  }
});

boot();
export { info };
