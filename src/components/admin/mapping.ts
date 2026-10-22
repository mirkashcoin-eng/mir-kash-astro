// Pure mapping from the People + Action inbox API responses to the view-models in
// types.ts. No fetching, no DOM — data.ts calls these, and they can be run in Node.
//
// Shapes come from src/pages/api/admin/people.ts and src/pages/api/admin/inbox.ts.
import type { HandledAction, InboxData, InboxGroup, InboxItem, InboxKind, PeopleList, PersonDetail, PersonRow, ScoreView, Stage, TimelineStep } from './types';

type Raw = Record<string, any>;
const arr = <T = Raw>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const num = (v: unknown): number => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const numOrNull = (v: unknown): number | null => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const str = (v: unknown): string => (v == null ? '' : String(v));

const STAGES: Stage[] = ['visited', 'viewed', 'cart', 'phone', 'address', 'payment', 'ordered'];
export const STAGE_LABEL: Record<Stage, string> = {
  visited: 'Visited', viewed: 'Viewed product', cart: 'Added to cart', phone: 'Added phone number',
  address: 'Added address', payment: 'Attempted payment', ordered: 'Ordered',
};

// ── Words ────────────────────────────────────────────────────────────────────
const SOURCE_NAMES: Record<string, string> = {
  instagram: 'Instagram', ig: 'Instagram', facebook: 'Facebook', fb: 'Facebook', meta: 'Meta', google: 'Google',
  bing: 'Bing', whatsapp: 'WhatsApp', direct: 'Direct', youtube: 'YouTube', pinterest: 'Pinterest',
  email: 'Email', newsletter: 'Newsletter', affiliate: 'Affiliate', chatgpt: 'ChatGPT', 'chatgpt.com': 'ChatGPT',
};
const MEDIUM_NAMES: Record<string, string> = {
  cpc: 'paid', paid: 'paid', paid_social: 'paid', ppc: 'paid', social: 'organic', organic: 'search',
  referral: 'referral', email: 'email', affiliate: 'affiliate',
};
export const titleCase = (s: string): string =>
  s.replace(/[_-]+/g, ' ').trim().replace(/\s+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

/** "Instagram · diwali", "Google · search", "Direct". */
export function sourceLabel(t: { source?: string | null; medium?: string | null; campaign?: string | null } | null | undefined): string {
  const src = str(t?.source).trim().toLowerCase();
  if (!src || src === '(direct)' || src === 'direct') return 'Direct';
  const name = SOURCE_NAMES[src] || titleCase(src);
  const extra = t?.campaign ? str(t.campaign) : MEDIUM_NAMES[str(t?.medium).toLowerCase()] || '';
  return extra && extra.toLowerCase() !== 'none' ? name + ' · ' + extra : name;
}

/** Shopify handle → a readable bag name: "tote-rust" → "Tote Rust". */
export const productName = (handle: unknown): string => (handle ? titleCase(String(handle)) : 'a bag');

const FLOW: Record<string, string> = { try_at_home: 'Try at Home', tryhome: 'Try at Home', try_home: 'Try at Home', private_viewing: 'Private Viewing', viewing: 'Private Viewing' };
export const flowName = (f: unknown): string => FLOW[str(f)] || (f ? titleCase(str(f)) : 'Booking');

const OUTCOME_LABEL: Record<string, string> = {
  contacted: 'Contacted', no_answer: 'No answer', ordered: 'Ordered', not_interested: 'Not interested',
  confirmed: 'Confirmed', completed: 'Completed', no_show: 'No-show', cancelled: 'Cancelled',
  restocking: 'Restocking', not_restocking: 'Not restocking',
};
export const outcomeLabel = (o: string): string => OUTCOME_LABEL[o] || titleCase(o);

const DEVICE: Record<string, string> = { mobile: 'Phone', tablet: 'Tablet', desktop: 'Desktop' };
export const deviceName = (d: unknown): string => (d ? DEVICE[str(d).toLowerCase()] || titleCase(str(d)) : '—');

function inrText(v: number, cur?: string | null): string {
  const c = (cur || 'INR').toUpperCase();
  try { return new Intl.NumberFormat('en-IN', { style: 'currency', currency: c, maximumFractionDigits: 0 }).format(Math.round(v)); }
  catch { return c + ' ' + Math.round(v); }
}

// IST: "Today, 10:12" / "Yesterday, 21:40" / "9 Oct, 19:05" / "9 Oct 2025, 19:05"
export function istWhen(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '';
  const day = (ms: number) => new Date(ms).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  const time = new Date(t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' });
  const d = day(t);
  if (d === day(now)) return 'Today, ' + time;
  if (d === day(now - 864e5)) return 'Yesterday, ' + time;
  const sameYear = d.slice(0, 4) === day(now).slice(0, 4);
  return new Date(t).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }), timeZone: 'Asia/Kolkata' }) + ', ' + time;
}
export function istDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '';
  return new Date(t).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });
}

// ── People list ──────────────────────────────────────────────────────────────
export function mapPersonRow(r: Raw): PersonRow {
  const stage = (STAGES as string[]).includes(r.stage) ? (r.stage as Stage) : 'visited';
  const city = str(r.city);
  const country = str(r.country);
  const engaged = numOrNull(r.engaged_ms);
  return {
    id: str(r.id),
    kind: r.kind === 'visitor' ? 'visitor' : 'person',
    name: str(r.name) || str(r.phone) || str(r.email) || 'Visitor',
    phone: r.phone ?? null,
    email: r.email ?? null,
    location: [city, country && country.toUpperCase() !== 'IN' ? country : ''].filter(Boolean).join(', '),
    stage,
    visits: num(r.visits),
    returning: Boolean(r.returning),
    source: sourceLabel(r.first_touch),
    lastSource: sourceLabel(r.last_touch),
    device: deviceName(r.device),
    timeOnSiteMin: engaged == null ? null : engaged / 60000,
    cartValue: numOrNull(r.cart_value),
    cartCurrency: r.cart_currency ?? null,
    score: numOrNull(r.score),
    reason: str(r.reason),
    orders: num(r.orders),
    ltv: num(r.ltv),
    products: arr<string>(r.products).map(String),
    firstSeen: r.first_seen ?? null,
    lastSeen: r.last_seen ?? null,
    bookingFlow: r.booking_flow ?? null,
    bookings: num(r.bookings),
    daysToFirstPurchase: numOrNull(r.days_to_first_purchase),
    whatsapp: r.whatsapp ?? null,
    isTest: Boolean(r.is_test),
  };
}

export function mapPeopleList(d: Raw): PeopleList {
  return {
    count: num(d?.count), total: num(d?.total), returning: num(d?.returning),
    page: num(d?.page) || 1, pages: num(d?.pages) || 1, size: num(d?.size) || 50,
    asOf: d?.as_of ?? null,
    rows: arr(d?.rows).map(mapPersonRow),
    stages: Object.fromEntries((STAGES as string[]).map((s) => [s, num(d?.stages?.[s])])) as Record<Stage, number>,
  };
}

// ── Timeline ─────────────────────────────────────────────────────────────────
// Events too small to list one by one. Page views and engaged time are summed
// onto their visit instead ("6 pages · 4 min").
const QUIET = new Set(['page_view', 'page_engaged', 'gallery_view', 'web_vital', 'cart_qty_change']);

function eventText(e: Raw): string | null {
  const p: Raw = e.props && typeof e.props === 'object' ? e.props : {};
  const bag = productName(e.product);
  const money = e.value != null && Number(e.value) > 0 ? ' · ' + inrText(Number(e.value), e.currency) : '';
  switch (e.name) {
    case 'product_view': return 'Looked at ' + bag;
    case 'sold_out_view': return 'Looked at ' + bag + (p.colour || p.color ? ' in ' + (p.colour || p.color) : '') + ' while sold out';
    case 'gallery_zoom': return 'Zoomed into a photo of ' + bag;
    case 'swatch_select': return 'Chose the ' + (p.colour || p.color || 'other') + ' colour' + (e.product ? ' of ' + bag : '');
    case 'section_open': return 'Opened ' + (p.section ? titleCase(String(p.section)).toLowerCase() : 'details') + (e.product ? ' on ' + bag : '');
    case 'related_product_click': return 'Clicked a related bag';
    case 'add_to_cart': return 'Added ' + bag + ' to cart' + money;
    case 'remove_from_cart': return 'Removed ' + bag + ' from cart';
    case 'cart_view': return 'Opened the cart';
    case 'checkout_start': return 'Started checkout';
    case 'otp_sent': return 'Asked for a checkout code';
    case 'otp_verified': return 'Confirmed their phone with the code';
    case 'otp_failed': return 'Checkout code didn’t work' + (p.reason ? ' (' + p.reason + ')' : '');
    case 'phone': return 'Entered phone number';
    case 'address': return 'Entered delivery address';
    case 'coupon_apply': return 'Tried coupon ' + (p.code ? String(p.code).toUpperCase() : '') + (p.valid === false ? ' (didn’t work)' : p.valid === true ? ' (worked)' : '');
    case 'payment_method': return 'Chose to pay by ' + (p.method ? String(p.method).toUpperCase() === 'COD' ? 'cash on delivery' : String(p.method) : 'another method');
    case 'payment_start': return 'Opened the payment window';
    case 'payment_success': return 'Paid' + money;
    case 'payment_failed': return 'Payment failed' + (p.reason ? ' (' + p.reason + ')' : '');
    case 'search': return 'Searched for “' + (p.q || '') + '”' + (p.results === 0 ? ' and found nothing' : '');
    case 'contact_click': return 'Tapped ' + (p.channel ? titleCase(String(p.channel)) : 'contact');
    case 'booking_step': {
      const step = p.step ?? p.bookingStep;
      return flowName(p.flow ?? p.bookingFlow) + ': ' + (step ? BOOKING_STEP[String(step)] || 'reached ' + titleCase(String(step)).toLowerCase() : 'started');
    }
    case 'booking_submitted': return 'Asked for a ' + flowName(p.flow ?? p.bookingFlow);
    case 'tryhome_switch_to_viewing': return 'Switched from Try at Home to Private Viewing';
    case 'js_error': return null;
  }
  if (/^(vp|cx|th)_/.test(String(e.name || ''))) return null;   // panel/step families: shown elsewhere
  return e.name ? titleCase(String(e.name)) : null;
}
const BOOKING_STEP: Record<string, string> = { cover: 'started', bags: 'chose pieces', datetime: 'chose a day', details: 'entered details', phone: 'entered phone' };

function itemsText(items: unknown): string {
  if (typeof items === 'string') return items;
  return arr(items).map((l: Raw) => (l.quantity && l.quantity > 1 ? l.quantity + '× ' : '') + (l.title || l.name || productName(l.handle))).filter(Boolean).join(', ');
}

/** The API's oldest-first items → readable steps, newest first. */
export function buildTimeline(items: Raw[], now = Date.now()): TimelineStep[] {
  const out: TimelineStep[] = [];
  let visit: (TimelineStep & { pages: number; ms: Map<string, number>; base: string }) | null = null;
  const closeVisit = () => {
    if (!visit) return;
    let ms = 0; visit.ms.forEach((v) => { ms += v; });
    const mins = Math.round(ms / 60000);
    const extra = [visit.pages ? visit.pages + (visit.pages === 1 ? ' page' : ' pages') : '', mins >= 1 ? mins + ' min' : ''].filter(Boolean).join(' · ');
    visit.sub = [visit.base, extra].filter(Boolean).join(' · ') || undefined;
    visit = null;
  };
  let last: TimelineStep & { n?: number } | null = null;
  for (const it of items) {
    if (it.type === 'visit') {
      closeVisit();
      const where = [deviceName(it.device) !== '—' ? deviceName(it.device) : '', it.city || ''].filter(Boolean).join(' · ');
      visit = {
        kind: 'visit', at: istWhen(it.ts, now), text: 'Visit ' + num(it.visit) + ' · ' + sourceLabel(it),
        pages: 0, ms: new Map(), base: [it.landing ? 'landed on ' + (it.landing === '/' ? 'the home page' : it.landing) : '', where].filter(Boolean).join(' · '),
      };
      out.push(visit);
      last = null;
      continue;
    }
    if (it.type === 'event') {
      if (it.name === 'page_view') { if (visit) visit.pages++; continue; }
      if (it.name === 'page_engaged') {
        // props.ms is a running total per page view: keep the largest.
        const ms = num(it.props?.ms);
        if (visit) visit.ms.set(str(it.page_view_id || it.event_id), Math.max(visit.ms.get(str(it.page_view_id || it.event_id)) || 0, ms));
        continue;
      }
      if (QUIET.has(it.name)) continue;
      const text = eventText(it);
      if (!text) continue;
      if (last && last.kind === 'event' && last.text === text) {   // "Looked at Tote Rust ×3"
        last.n = (last.n || 1) + 1;
        continue;
      }
      last = { kind: 'event', at: istWhen(it.ts, now), text, sub: visit ? visit.text.split(' · ')[0] : undefined };
      out.push(last);
      continue;
    }
    last = null;
    if (it.type === 'order') {
      const total = it.total_inr != null ? inrText(num(it.total_inr)) : inrText(num(it.total), it.currency);
      out.push({
        kind: 'order', at: istWhen(it.ts, now),
        text: (it.cancelled_at ? 'Order cancelled · ' : 'Ordered · ') + total + (it.name ? ' (' + it.name + ')' : ''),
        sub: [itemsText(it.items), it.payment_method ? (String(it.payment_method).toLowerCase() === 'cod' ? 'cash on delivery' : 'paid online') : '',
          it.likely_gift ? 'likely a gift' + (it.shipping_city ? ' · to ' + it.shipping_city : '') : ''].filter(Boolean).join(' · ') || undefined,
      });
    } else if (it.type === 'booking') {
      const bags = arr(it.bags).length;
      const when = [it.date ? istDate(it.date + 'T06:30:00Z') : '', it.slot || ''].filter(Boolean).join(', ');
      out.push({
        kind: 'booking', at: istWhen(it.ts, now),
        text: 'Booked ' + flowName(it.flow) + (when ? ' for ' + when : ''),
        sub: [bags ? bags + (bags === 1 ? ' bag' : ' bags') : '', it.city || '', it.outcome ? outcomeLabel(String(it.outcome)) : it.status ? titleCase(String(it.status)) : ''].filter(Boolean).join(' · ') || undefined,
      });
    }
  }
  closeVisit();
  for (const s of out as (TimelineStep & { n?: number; pages?: number; ms?: unknown; base?: unknown })[]) {
    if (s.n && s.n > 1) s.text += ' ×' + s.n;
    delete s.n; delete s.pages; delete s.ms; delete s.base;
  }
  return out.reverse();
}

function mapScore(b: Raw | null | undefined): ScoreView | null {
  if (!b || !Array.isArray(b.parts)) return null;
  return {
    score: numOrNull(b.score), notALead: b.notALead ?? null, subtotal: num(b.subtotal),
    fade: b.fade ? { factor: num(b.fade.factor), note: str(b.fade.note) } : null,
    parts: b.parts.map((x: Raw) => ({ key: str(x.key), label: str(x.label), detail: str(x.detail), points: num(x.points), max: num(x.max) })),
  };
}

export function mapPersonDetail(d: Raw, now = Date.now()): PersonDetail {
  const row = d?.summary ? mapPersonRow(d.summary) : null;
  const pr: Raw | null = d?.person || null;
  const address = pr ? [pr.address1, [pr.city, pr.province, pr.pin].filter(Boolean).join(' ')].filter(Boolean).join(', ') : '';
  const handled: HandledAction[] = arr(d?.actions).map((a: Raw) => ({
    at: str(a.done_at), by: str(a.done_by), outcome: str(a.outcome), note: a.note ?? null, kind: str(a.kind),
  }));
  return {
    id: str(d?.id),
    row,
    name: str(pr?.name) || row?.name || str(pr?.phone) || 'Visitor',
    phone: pr?.phone ?? row?.phone ?? null,
    email: pr?.email ?? row?.email ?? null,
    whatsapp: pr?.whatsapp ?? row?.whatsapp ?? null,
    address: address || null,
    firstSeen: row?.firstSeen ?? pr?.first_seen ?? null,
    counts: { visits: num(d?.counts?.visits), events: num(d?.counts?.events), orders: num(d?.counts?.orders), bookings: num(d?.counts?.bookings) },
    handled,
    score: mapScore(d?.score_breakdown),
    timeline: buildTimeline(arr(d?.timeline), now),
  };
}

// ── Inbox ────────────────────────────────────────────────────────────────────
// Design order: who to call, money that failed, bookings, then restock.
const GROUPS: { key: InboxKind; title: string }[] = [
  { key: 'hot_lead', title: 'Ready to buy' },
  { key: 'payment_failed', title: 'Payment didn’t go through' },
  { key: 'booking_confirm', title: 'Bookings to confirm' },
  { key: 'restock', title: 'Wanted but sold out' },
];
export const DEFAULT_OUTCOMES: Record<InboxKind, string[]> = {
  hot_lead: ['contacted', 'no_answer', 'ordered', 'not_interested'],
  payment_failed: ['contacted', 'no_answer', 'ordered', 'not_interested'],
  booking_confirm: ['confirmed', 'completed', 'no_show', 'cancelled'],
  restock: ['restocking', 'not_restocking'],
};

export function mapInbox(d: Raw): InboxData {
  const items: InboxItem[] = arr(d?.items)
    .filter((it: Raw) => GROUPS.some((g) => g.key === it.kind) && it.ref)
    .map((it: Raw) => ({
      id: it.kind + ':' + it.ref,
      kind: it.kind as InboxKind,
      ref: str(it.ref),
      title: str(it.title),
      detail: str(it.reason),
      value: numOrNull(it.value),
      whatsapp: it.whatsapp ?? null,
      personId: it.person_id ?? null,
      createdAt: it.created_at ?? null,
      outcomes: arr<string>(it.outcomes).length ? arr<string>(it.outcomes).map(String) : DEFAULT_OUTCOMES[it.kind as InboxKind],
    }));
  // The API sorts by priority; keep that order inside each group.
  const groups: InboxGroup[] = GROUPS.map((g) => ({ ...g, items: items.filter((i) => i.kind === g.key) })).filter((g) => g.items.length);
  return { total: items.length, asOf: d?.as_of ?? null, hotThreshold: numOrNull(d?.hot_threshold), groups };
}
