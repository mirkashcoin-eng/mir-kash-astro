import type { APIRoute } from 'astro';
import { requestIsAdmin } from '~/lib/adminAuth';
import { q } from '~/lib/db';
import { leadReason, scoreBreakdown, scoreSql } from '~/lib/leadscore';
import { waNumber } from '~/lib/whatsapp';

export const prerender = false;

// Founders-only People section of /admin, from Neon (v_people / mv_people).
//
// GET                      → one page of the list, plus totals for the filter
// GET ?id=<id>             → one person (or anonymous browser 'v:<visitor_id>') with
//                            their full chronological timeline
//
// The list never truncates the population — it only paginates — and its totals
// count every match. Bots and test numbers are off unless asked for.
const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex, nofollow' },
  });

const STAGES = ['visited', 'viewed', 'cart', 'checkout', 'phone', 'address', 'payment', 'ordered'] as const;
const SORTS: Record<string, string> = {
  last_seen: 'last_seen',
  first_seen: 'first_seen',
  score: 'score',
  value: 'ltv',             // lifetime value (INR), then cart value
  cart: 'cart_value',
  visits: 'visits',
};
const MAX_SIZE = 100;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

type Row = Record<string, any>;
const n = (v: unknown): number => (v == null ? 0 : Number(v));
const iso = (v: unknown): string | null => (v instanceof Date ? v.toISOString() : v == null ? null : String(v));

function waLink(phone: string | null | undefined, text?: string): string | null {
  const to = waNumber(phone);
  if (to.length < 11) return null;
  return `https://wa.me/${to}${text ? `?text=${encodeURIComponent(text)}` : ''}`;
}

// One mv_people row → the API shape (numbers as numbers, dates as ISO, score + reason).
function shape(r: Row) {
  return {
    id: r.id,
    kind: r.kind,
    name: r.name ?? null,
    phone: r.phone ?? null,
    email: r.email ?? null,
    first_seen: iso(r.first_seen),
    last_seen: iso(r.last_seen),
    visits: n(r.visits),
    returning: Boolean(r.is_returning),
    first_touch: { source: r.first_source ?? null, medium: r.first_medium ?? null, campaign: r.first_campaign ?? null },
    last_touch: { source: r.last_source ?? null, medium: r.last_medium ?? null, campaign: r.last_campaign ?? null },
    device: r.device ?? null,
    city: r.city ?? null,
    country: r.country ?? null,
    products: r.products ?? [],
    engaged_ms: n(r.engaged_ms),
    stage: r.stage,
    cart_value: r.cart_value == null ? null : n(r.cart_value),
    cart_currency: r.cart_currency ?? null,
    last_cart_at: iso(r.last_cart_at),
    phone_given: Boolean(r.phone_given),
    booking_started: Boolean(r.booking_started),
    booking_flow: r.booking_flow ?? null,
    checkout_reached: Boolean(r.checkout_reached),
    bookings: n(r.bookings),
    orders: n(r.orders),
    ltv: n(r.ltv),
    first_order_at: iso(r.first_order_at),
    last_order_at: iso(r.last_order_at),
    days_to_first_purchase: r.days_to_first_purchase == null ? null : n(r.days_to_first_purchase),
    is_bot: Boolean(r.is_bot),
    is_test: Boolean(r.is_test),
    score: r.score == null ? null : n(r.score),
    reason: leadReason(r as any),
    whatsapp: waLink(r.phone),
  };
}

// Rebuild mv_people if it is more than a few minutes old (see 004_people.sql).
// Returns when the list was built, or null when the database is unavailable.
async function freshPeople(): Promise<string | null> {
  const r = await q<{ at: Date }>('SELECT people_refresh() AS at');
  return r?.[0] ? iso(r[0].at) : null;
}

export const GET: APIRoute = async ({ request }) => {
  if (!(await requestIsAdmin(request))) return json({ error: 'Not authorised' }, 401);
  const url = new URL(request.url);
  const id = (url.searchParams.get('id') || '').trim();
  return id ? detail(id) : list(url.searchParams);
};

// ── List ─────────────────────────────────────────────────────────────────────
//
// Params (all optional):
//   q            search: name, phone, email, bag handle, source / campaign
//   stage        visited | viewed | cart | checkout | phone | address | payment | ordered
//   returning=1  more than one visit
//   kind         person | visitor
//   source       first- OR last-touch source (e.g. instagram)
//   device       mobile | tablet | desktop
//   city         exact, case-insensitive
//   from, to     first seen between these IST dates (YYYY-MM-DD, inclusive)
//   range=active from/to instead mean "had a visit that started in the range" — the
//                definition every /admin metrics section uses, so a drill-down from a
//                number lands on the same people
//   min_score    only leads scoring at least this
//   include_bots=1, include_test=1
//   sort         last_seen (default) | first_seen | score | value | cart | visits
//   dir          desc (default) | asc
//   page (1-based, default 1), size (default 50, max 100)
async function list(sp: URLSearchParams): Promise<Response> {
  const asOf = await freshPeople();
  if (!asOf) return json({ error: 'Database unavailable' }, 503);

  const params: unknown[] = [];
  const p = (v: unknown) => { params.push(v); return `$${params.length}`; };

  // Base: what "everyone" means (the M in "N of M").
  const base: string[] = [];
  if (sp.get('include_bots') !== '1') base.push('NOT is_bot');
  if (sp.get('include_test') !== '1') base.push('NOT is_test');

  // Filters: the N.
  const f: string[] = [];
  let stageCond = '';
  const qs = (sp.get('q') || '').trim().toLowerCase().slice(0, 100);
  if (qs) {
    // Phones are stored as +91XXXXXXXXXX; a typed number is matched on its digits
    // so "98765 43210" and "+91-98765-43210" both find it.
    const like = (s: string) => `%${s.replace(/[\\%_]/g, (m) => '\\' + m)}%`;
    const digits = qs.replace(/[^0-9]/g, '');
    const term = /^[\d\s+()-]+$/.test(qs) && digits.length >= 4 ? digits.slice(-10) : qs;
    f.push(`search LIKE ${p(like(term))}`);
  }
  const stage = sp.get('stage');
  if (stage) {
    if (!(STAGES as readonly string[]).includes(stage)) return json({ error: 'Unknown stage' }, 400);
    stageCond = `stage = '${stage}'`;   // safe: checked against STAGES above
  }
  if (sp.get('returning') === '1') f.push('is_returning');
  const kind = sp.get('kind');
  if (kind === 'person' || kind === 'visitor') f.push(`kind = ${p(kind)}`);
  const source = (sp.get('source') || '').trim().toLowerCase();
  if (source) f.push(`${p(source)} IN (first_source, last_source)`);
  const device = (sp.get('device') || '').trim().toLowerCase();
  if (device) f.push(`device = ${p(device)}`);
  const city = (sp.get('city') || '').trim();
  if (city) f.push(`lower(city) = lower(${p(city)})`);
  const from = sp.get('from'), to = sp.get('to');
  if (from && !DAY.test(from)) return json({ error: 'from must be YYYY-MM-DD' }, 400);
  if (to && !DAY.test(to)) return json({ error: 'to must be YYYY-MM-DD' }, 400);
  const lo = from ? `(${p(from)}::date)::timestamp AT TIME ZONE 'Asia/Kolkata'` : null;
  const hi = to ? `(${p(to)}::date + 1)::timestamp AT TIME ZONE 'Asia/Kolkata'` : null;
  if (sp.get('range') === 'active' && (lo || hi)) {
    // A visit in the range, on any of the row's browsers. Two branches so each uses an
    // index: visitors(person_id) for people, sessions(visitor_id, started_at) for both.
    // `s` is the outer row (FROM (scored) s); sessions are aliased `ss`.
    const inRange = [lo && `ss.started_at >= ${lo}`, hi && `ss.started_at < ${hi}`].filter(Boolean).join(' AND ');
    f.push(`((s.kind = 'person' AND EXISTS (SELECT 1 FROM visitors v JOIN sessions ss ON ss.visitor_id = v.visitor_id
                WHERE v.person_id = s.id AND ${inRange}))
          OR (s.kind = 'visitor' AND EXISTS (SELECT 1 FROM sessions ss
                WHERE ss.visitor_id = substr(s.id, 3) AND ${inRange})))`);
  } else {
    if (lo) f.push(`first_seen >= ${lo}`);
    if (hi) f.push(`first_seen < ${hi}`);
  }
  const minScore = sp.get('min_score');
  if (minScore && Number.isFinite(Number(minScore))) f.push(`score >= ${p(Number(minScore))}`);

  const sortKey = SORTS[sp.get('sort') || 'last_seen'] ? (sp.get('sort') || 'last_seen') : 'last_seen';
  const dir = sp.get('dir') === 'asc' ? 'ASC' : 'DESC';
  const col = SORTS[sortKey];
  const order = `${col} ${dir} NULLS LAST${sortKey === 'value' ? `, cart_value ${dir} NULLS LAST` : ''}, id`;

  const size = Math.min(MAX_SIZE, Math.max(1, parseInt(sp.get('size') || '50', 10) || 50));
  const page = Math.max(1, parseInt(sp.get('page') || '1', 10) || 1);

  // Score is computed per row (cheap arithmetic); only rows that pass the base
  // exclusions are scored.
  const scored = `SELECT m.*, ${scoreSql('m')} AS score FROM mv_people m${base.length ? ` WHERE ${base.join(' AND ')}` : ''}`;
  const where = [...f, ...(stageCond ? [stageCond] : [])].join(' AND ') || 'true';
  // The step strip: how many people sit at each step under every filter EXCEPT the step
  // itself, so picking a step doesn't zero out the others.
  const whereAnyStage = f.length ? f.join(' AND ') : 'true';

  const [totals, rows, stageRows] = await Promise.all([
    q<{ count: string; returning: string; total: string }>(
      `SELECT count(*) FILTER (WHERE ${where}) AS count,
              count(*) FILTER (WHERE ${where} AND is_returning) AS returning,
              count(*) AS total
       FROM (${scored}) s`, params),
    q(`SELECT * FROM (${scored}) s WHERE ${where} ORDER BY ${order} LIMIT ${size} OFFSET ${(page - 1) * size}`, params),
    q<{ stage: string; n: string }>(`SELECT stage, count(*) AS n FROM (${scored}) s WHERE ${whereAnyStage} GROUP BY stage`, params),
  ]);
  if (!totals || !rows || !stageRows) return json({ error: 'Query failed' }, 500);
  const stages: Record<string, number> = Object.fromEntries(STAGES.map((s) => [s, 0]));
  for (const r of stageRows) stages[r.stage] = n(r.n);

  const count = n(totals[0]?.count);
  return json({
    as_of: asOf,
    page, size, pages: Math.max(1, Math.ceil(count / size)),
    count,                               // N: people matching the filters
    stages,                              // people at each step (furthest one reached), under the same filters but not the step itself
    returning: n(totals[0]?.returning),  // …of whom returning
    total: n(totals[0]?.total),          // M: everyone (bots/test excluded unless asked)
    sort: sortKey, dir: dir.toLowerCase(),
    rows: rows.map(shape),
  });
}

// ── One person + timeline ────────────────────────────────────────────────────
//
// Everything every linked browser ever did, oldest first, with a 'visit' item at
// each session start carrying that visit's source, plus orders and bookings.
// Read live from the tables (the summary row comes from mv_people).
async function detail(id: string): Promise<Response> {
  if (id.length > 220) return json({ error: 'Bad id' }, 400);
  const asOf = await freshPeople();
  if (!asOf) return json({ error: 'Database unavailable' }, 503);

  const anon = id.startsWith('v:');
  const personId = anon ? null : id;
  const [summary, person, visitors] = await Promise.all([
    q(`SELECT m.*, ${scoreSql('m')} AS score FROM mv_people m WHERE m.id = $1`, [id]),
    personId ? q(`SELECT * FROM people WHERE person_id = $1`, [personId]) : Promise.resolve([]),
    anon
      ? q(`SELECT visitor_id, first_seen, last_seen, is_bot, bot_name, is_test FROM visitors WHERE visitor_id = $1`, [id.slice(2)])
      : q(`SELECT visitor_id, first_seen, last_seen, is_bot, bot_name, is_test FROM visitors WHERE person_id = $1 ORDER BY first_seen`, [personId]),
  ]);
  if (!summary || !person || !visitors) return json({ error: 'Query failed' }, 500);
  if (!summary.length && !person.length && !visitors.length) return json({ error: 'Not found' }, 404);

  const vids = visitors.map((v: Row) => v.visitor_id);
  const [events, sessions, orders, bookings, actions] = await Promise.all([
    vids.length
      ? q(`SELECT event_id, ts, client_ts, visitor_id, session_id, name, page, page_view_id, product, value, currency, props, migrated
           FROM events WHERE visitor_id = ANY($1) ORDER BY ts, client_ts NULLS LAST, event_id`, [vids])
      : Promise.resolve([]),
    vids.length
      ? q(`SELECT * FROM sessions WHERE visitor_id = ANY($1) ORDER BY started_at`, [vids])
      : Promise.resolve([]),
    personId ? q(`SELECT * FROM orders WHERE person_id = $1 ORDER BY created_at`, [personId]) : Promise.resolve([]),
    personId ? q(`SELECT booking_id, flow, created_at, date::text AS day, slot, city, bags, status, outcome, outcome_at
               FROM bookings WHERE person_id = $1 ORDER BY created_at`, [personId]) : Promise.resolve([]),
    q(`SELECT kind, ref, done_at, done_by, outcome, note FROM inbox_actions WHERE ref = $1 ORDER BY done_at DESC`, [id]),
  ]);
  if (!events || !sessions || !orders || !bookings || !actions) return json({ error: 'Query failed' }, 500);

  // A visit marker per session. Sessions without a row (e.g. migrated history)
  // start at their first event.
  type Item = { type: string; ts: string; order: number } & Row;
  const items: Item[] = [];
  const known = new Map<string, Row>(sessions.map((s: Row) => [s.session_id, s]));
  const firstEvent = new Map<string, Row>();
  for (const e of events) if (!firstEvent.has(e.session_id)) firstEvent.set(e.session_id, e);
  const sessionIds = [...new Set([...sessions.map((s: Row) => s.session_id), ...firstEvent.keys()])];
  const starts = sessionIds.map((sid) => {
    const s = known.get(sid), e = firstEvent.get(sid);
    const t = s?.started_at && e?.ts ? (new Date(s.started_at) < new Date(e.ts) ? s.started_at : e.ts) : s?.started_at ?? e?.ts;
    return { sid, s, e, ts: iso(t) as string };
  }).sort((x, y) => x.ts.localeCompare(y.ts));
  starts.forEach(({ sid, s, e, ts }, i) => items.push({
    type: 'visit', ts, order: 0, visit: i + 1, session_id: sid, visitor_id: s?.visitor_id ?? e?.visitor_id,
    source: s?.source ?? null, medium: s?.medium ?? null, campaign: s?.campaign ?? null, content: s?.content ?? null,
    term: s?.term ?? null, affiliate: s?.affiliate ?? null, landing: s?.landing ?? null, referrer: s?.referrer ?? null,
    device: s?.device ?? null, os: s?.os ?? null, browser: s?.browser ?? null, screen: s?.screen ?? null,
    city: s?.city ?? null, country: s?.country ?? null, last_at: iso(s?.last_at),
  }));
  for (const e of events) items.push({
    type: 'event', ts: iso(e.ts) as string, order: 1, event_id: e.event_id, session_id: e.session_id, visitor_id: e.visitor_id,
    name: e.name, page: e.page, page_view_id: e.page_view_id, product: e.product,
    value: e.value == null ? null : n(e.value), currency: e.currency, props: e.props, migrated: e.migrated,
  });
  for (const o of orders) items.push({
    type: 'order', ts: iso(o.created_at) as string, order: 2, order_id: o.order_id, store: o.store, name: o.name,
    currency: o.currency, total: n(o.total), total_inr: o.total_inr == null ? null : n(o.total_inr),
    cancelled_at: iso(o.cancelled_at), items: o.items, discount_codes: o.discount_codes, payment_method: o.payment_method,
    financial_status: o.financial_status, fulfillment_status: o.fulfillment_status, likely_gift: o.likely_gift,
    shipping_city: o.shipping_city,
  });
  for (const b of bookings) items.push({
    type: 'booking', ts: iso(b.created_at) as string, order: 2, booking_id: b.booking_id, flow: b.flow,
    date: b.day, slot: b.slot, city: b.city,
    bags: b.bags, status: b.status, outcome: b.outcome, outcome_at: iso(b.outcome_at),
  });
  items.sort((x, y) => x.ts.localeCompare(y.ts) || x.order - y.order);

  const pr = person[0] as Row | undefined;
  return json({
    as_of: asOf,
    id,
    summary: summary[0] ? shape(summary[0]) : null,   // null: new since the list was built, or a one-page visitor
    score_breakdown: summary[0] ? scoreBreakdown(summary[0] as any) : null,   // the points behind `summary.score`
    person: pr ? {
      person_id: pr.person_id, name: pr.name, phone: pr.phone, email: pr.email, address1: pr.address1,
      city: pr.city, province: pr.province, pin: pr.pin, first_seen: iso(pr.first_seen), is_test: pr.is_test,
      whatsapp: waLink(pr.phone),
    } : null,
    visitors: visitors.map((v: Row) => ({ ...v, first_seen: iso(v.first_seen), last_seen: iso(v.last_seen) })),
    actions: actions.map((a: Row) => ({ ...a, done_at: iso(a.done_at) })),
    counts: { visits: starts.length, events: events.length, orders: orders.length, bookings: bookings.length },
    timeline: items.map(({ order: _o, ...rest }) => rest),
  });
}
