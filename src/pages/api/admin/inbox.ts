import type { APIRoute } from 'astro';
import { isAdmin, requestIsAdmin } from '~/lib/adminAuth';
import { getAdminRole } from '~/lib/adminRoles';
import { verifyFirebaseUser } from '~/lib/firebaseAuth';
import { q, tx } from '~/lib/db';
import { personIdFor } from '~/lib/events';
import { HANDLED_DAYS, HOT_THRESHOLD, inrShort, leadReason, scoreSql, whenIst } from '~/lib/leadscore';
import { getAbandonedDrafts } from '~/lib/shopify/admin';
import { waNumber } from '~/lib/whatsapp';

export const prerender = false;

// Founders-only Action inbox — the first screen of /admin: who to contact today and
// why, ranked. Loaded once per page load (no polling).
//
// GET  → { as_of, counts, items: [{ kind, ref, title, reason, value, currency,
//          whatsapp, created_at, person_id, priority, outcomes }] }
// POST { kind, ref, outcome, note? } → marks an item done (inbox_actions, done_by =
//          the signed-in founder). A booking outcome also updates bookings.outcome.
//
// Kinds (highest priority first):
//   payment_failed   a payment failed, or an India payment draft was left open, in
//                    the last 7 days, and they haven't ordered since
//   booking_confirm  a Try at Home / Private Viewing booking today or tomorrow to
//                    confirm, or one in the last 30 days with no outcome recorded
//   hot_lead         lead score ≥ HOT_THRESHOLD, seen in the last 30 days, not handled
//                    in the last HANDLED_DAYS days
//   restock          sold-out colours people kept looking at in the last 30 days
// Bots and test numbers never appear.
const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex, nofollow' },
  });

const KINDS = ['hot_lead', 'payment_failed', 'booking_confirm', 'restock'] as const;
type Kind = (typeof KINDS)[number];
// Suggested outcomes per kind (free text is accepted too). A booking outcome is
// written to bookings.outcome when it is one of BOOKING_OUTCOMES.
const OUTCOMES: Record<Kind, string[]> = {
  hot_lead: ['contacted', 'no_answer', 'ordered', 'not_interested'],
  payment_failed: ['contacted', 'no_answer', 'ordered', 'not_interested'],
  booking_confirm: ['confirmed', 'completed', 'no_show', 'cancelled'],
  restock: ['restocking', 'not_restocking'],
};
const BOOKING_OUTCOMES = ['completed', 'no_show', 'cancelled'];

type Row = Record<string, any>;
interface Item {
  kind: Kind;
  ref: string;
  title: string;
  reason: string;
  value: number | null;      // INR at stake, when there is one
  currency: string | null;
  whatsapp: string | null;   // wa.me link with a short opener, when we have a phone
  created_at: string | null; // when the thing happened
  person_id: string | null;  // open in People (?id=)
  priority: number;          // items are sorted by this, highest first
  outcomes: string[];
}

const iso = (v: unknown): string | null => (v instanceof Date ? v.toISOString() : v == null ? null : String(v));
const firstName = (name: string | null | undefined) => (name || '').trim().split(/\s+/)[0] || '';
const who = (r: Row) => r.name || r.phone || r.email || 'Someone';

function waLink(phone: string | null | undefined, text: string): string | null {
  const to = waNumber(phone);
  if (to.length < 11) return null;
  return `https://wa.me/${to}?text=${encodeURIComponent(text)}`;
}
const hello = (name: string | null | undefined) => `Hi${firstName(name) ? ' ' + firstName(name) : ''}, this is Mir Kash.`;

// The signed-in founder's email (same rule as requestIsAdmin), for done_by.
async function founderEmail(request: Request): Promise<string | null> {
  const token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token) return null;
  const user = await verifyFirebaseUser(token);
  if (!user?.email) return null;
  if (isAdmin(user.email)) return user.email.toLowerCase();
  return (await getAdminRole(user.email)) === 'full' ? user.email.toLowerCase() : null;
}

// Not a bot, not a test browser, not a test number. `v` = a visitors alias.
const REAL_VISITOR = (v: string) =>
  `NOT ${v}.is_bot AND NOT ${v}.is_test AND NOT EXISTS (SELECT 1 FROM test_people t WHERE t.person_id = ${v}.person_id)`;

// ── Sources ──────────────────────────────────────────────────────────────────

async function hotLeads(): Promise<Item[] | null> {
  const rows = await q(
    `SELECT * FROM (
       SELECT m.*, ${scoreSql('m')} AS score FROM mv_people m
       WHERE m.kind = 'person' AND NOT m.is_bot AND NOT m.is_test AND m.last_seen > now() - interval '30 days'
     ) s
     WHERE s.score >= $1
       AND NOT EXISTS (SELECT 1 FROM inbox_actions a WHERE a.kind = 'hot_lead' AND a.ref = s.id
                       AND a.done_at > now() - make_interval(days => $2))
     ORDER BY s.score DESC, s.last_seen DESC`,
    [HOT_THRESHOLD, HANDLED_DAYS],
  );
  if (!rows) return null;
  return rows.map((r: Row) => {
    const cart = r.cart_value == null ? null : Number(r.cart_value);
    return {
      kind: 'hot_lead', ref: r.id,
      title: `${who(r)} · score ${r.score}`,
      reason: leadReason(r as any),
      value: cart && (r.cart_currency || 'INR') === 'INR' ? cart : null,
      currency: cart ? r.cart_currency || 'INR' : null,
      whatsapp: waLink(r.phone, hello(r.name)),
      created_at: iso(r.last_seen),
      person_id: r.person_id,
      priority: 200 + Number(r.score),
      outcomes: OUTCOMES.hot_lead,
    };
  });
}

async function paymentFailures(): Promise<Item[] | null> {
  // Failed payments from our own event log, one item per person (or browser).
  const failed = await q(
    `SELECT f.key, f.at, f.n, f.reason, p.name, p.phone, p.email, c.cart_value, c.cart_currency
     FROM (
       SELECT COALESCE(v.person_id, 'v:' || v.visitor_id) AS key, max(e.ts) AS at, count(*) AS n,
              (array_agg(e.props->>'reason' ORDER BY e.ts DESC))[1] AS reason
       FROM events e JOIN visitors v ON v.visitor_id = e.visitor_id
       WHERE e.name = 'payment_failed' AND e.ts > now() - interval '7 days' AND ${REAL_VISITOR('v')}
       GROUP BY 1
     ) f
     LEFT JOIN people p ON p.person_id = f.key
     -- their latest cart, read live from any of their browsers
     LEFT JOIN LATERAL (
       SELECT CASE WHEN e.props->>'cart_total' ~ '^[0-9]{1,9}(\\.[0-9]+)?$' THEN (e.props->>'cart_total')::numeric END AS cart_value,
              e.currency AS cart_currency
       FROM events e
       WHERE e.name = 'add_to_cart' AND e.visitor_id = ANY(
         CASE WHEN f.key LIKE 'v:%' THEN ARRAY[substr(f.key, 3)]
              ELSE ARRAY(SELECT visitor_id FROM visitors WHERE person_id = f.key) END)
       ORDER BY e.ts DESC LIMIT 1
     ) c ON true
     WHERE NOT COALESCE(p.is_test, false)
       AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.person_id = f.key AND o.cancelled_at IS NULL AND o.created_at >= f.at)
       AND NOT EXISTS (SELECT 1 FROM inbox_actions a WHERE a.kind = 'payment_failed' AND a.ref = f.key AND a.done_at >= f.at)`,
  );
  if (!failed) return null;

  // India payment drafts left open (Shopify). Best-effort: Shopify down → none.
  const weekAgo = Date.now() - 7 * 864e5;
  const drafts = (await getAbandonedDrafts().catch(() => [])).filter((d) => new Date(d.createdAt).getTime() >= weekAgo);
  const draftKeys = drafts.map((d) => personIdFor(d.phone, d.email)).filter(Boolean);
  const [ordered, handled, tests] = await Promise.all([
    draftKeys.length
      ? q(`SELECT person_id, max(created_at) AS at FROM orders WHERE person_id = ANY($1) AND cancelled_at IS NULL GROUP BY 1`, [draftKeys])
      : Promise.resolve([]),
    drafts.length
      ? q(`SELECT ref, max(done_at) AS at FROM inbox_actions WHERE kind = 'payment_failed' AND ref = ANY($1) GROUP BY 1`,
          [[...drafts.map((d) => d.id), ...draftKeys]])
      : Promise.resolve([]),
    draftKeys.length
      ? q(`SELECT person_id FROM people WHERE person_id = ANY($1) AND is_test
           UNION SELECT person_id FROM test_people WHERE person_id = ANY($1)`, [draftKeys])
      : Promise.resolve([]),
  ]);
  const orderedAt = new Map((ordered ?? []).map((r: Row) => [r.person_id, new Date(r.at).getTime()]));
  const handledAt = new Map((handled ?? []).map((r: Row) => [r.ref, new Date(r.at).getTime()]));
  const isTest = new Set((tests ?? []).map((r: Row) => r.person_id));

  const items = new Map<string, Item>();
  for (const d of drafts) {
    const key = personIdFor(d.phone, d.email) || d.id;
    const at = new Date(d.createdAt).getTime();
    if (isTest.has(key)) continue;
    if ((orderedAt.get(key) ?? 0) >= at) continue;
    if ((handledAt.get(d.id) ?? 0) >= at || (handledAt.get(key) ?? 0) >= at) continue;
    const amount = d.total ? Number(d.total.amount) : null;
    const inr = d.total?.currencyCode === 'INR' ? amount : null;
    items.set(key, {
      kind: 'payment_failed', ref: d.id,
      title: `${d.customer || d.phone || d.email || 'Someone'} · payment not completed`,
      reason: [inr ? `${inrShort(inr)} order` : null, d.items || null, `left ${whenIst(d.createdAt)}`].filter(Boolean).join(' · '),
      value: inr, currency: d.total?.currencyCode ?? null,
      whatsapp: waLink(d.phone, `${hello(d.customer)} Your order didn't go through — shall we send you a fresh payment link?`),
      created_at: d.createdAt,
      person_id: personIdFor(d.phone, d.email) || null,
      priority: 400 + Math.min(99, Math.round((inr ?? 0) / 1000)),
      outcomes: OUTCOMES.payment_failed,
    });
  }
  for (const f of failed as Row[]) {
    if (items.has(f.key)) continue;                // the Shopify draft says more
    const cart = f.cart_value == null ? null : Number(f.cart_value);
    const inr = cart && (f.cart_currency || 'INR') === 'INR' ? cart : null;
    const tries = Number(f.n);
    items.set(f.key, {
      kind: 'payment_failed', ref: f.key,
      title: `${who(f)} · payment failed${tries > 1 ? ` ${tries}×` : ''}`,
      reason: [inr ? `${inrShort(inr)} cart` : null, f.reason ? `“${f.reason}”` : null, whenIst(f.at)].filter(Boolean).join(' · '),
      value: inr, currency: inr ? 'INR' : null,
      whatsapp: waLink(f.phone, `${hello(f.name)} Your payment didn't go through — shall we send you a fresh payment link?`),
      created_at: iso(f.at),
      person_id: String(f.key).startsWith('v:') ? null : f.key,
      priority: 400 + Math.min(99, Math.round((inr ?? 0) / 1000)),
      outcomes: OUTCOMES.payment_failed,
    });
  }
  return [...items.values()];
}

async function bookingsToConfirm(): Promise<Item[] | null> {
  // Upcoming (today/tomorrow, IST): hide once someone confirmed it. Past (last 30
  // days): stays until an outcome is recorded.
  const rows = await q(
    `SELECT b.booking_id, b.flow, b.person_id, b.created_at, b.date::text AS day, b.slot, b.city, b.bags,
            p.name, p.phone, p.email, (b.date - (now() AT TIME ZONE 'Asia/Kolkata')::date) AS in_days
     FROM bookings b LEFT JOIN people p ON p.person_id = b.person_id
     WHERE b.outcome IS NULL AND b.date IS NOT NULL
       AND b.date BETWEEN (now() AT TIME ZONE 'Asia/Kolkata')::date - 30 AND (now() AT TIME ZONE 'Asia/Kolkata')::date + 1
       AND NOT COALESCE(p.is_test, false)
       AND NOT EXISTS (SELECT 1 FROM test_people t WHERE t.person_id = b.person_id)
       AND NOT (b.date >= (now() AT TIME ZONE 'Asia/Kolkata')::date
                AND EXISTS (SELECT 1 FROM inbox_actions a WHERE a.kind = 'booking_confirm' AND a.ref = b.booking_id))
     ORDER BY b.date, b.slot`,
  );
  if (!rows) return null;
  return rows.map((b: Row) => {
    const flow = b.flow === 'private_viewing' ? 'Private Viewing' : 'Try at Home';
    const d = Number(b.in_days);
    const day = d === 0 ? 'today' : d === 1 ? 'tomorrow' : whenIst(`${b.day}T06:30:00Z`);
    const bags = (b.bags ?? []).length;
    return {
      kind: 'booking_confirm', ref: b.booking_id,
      title: d >= 0 ? `Confirm ${flow} · ${who(b)} · ${day}` : `How did ${who(b)}'s ${flow} go?`,
      reason: [d < 0 ? `was ${day}` : day, b.slot, bags ? `${bags} bag${bags > 1 ? 's' : ''}` : null, b.city].filter(Boolean).join(' · '),
      value: null, currency: null,
      whatsapp: d >= 0
        ? waLink(b.phone, `${hello(b.name)} Confirming your ${flow} ${day}${b.slot ? `, ${b.slot}` : ''}.`)
        : waLink(b.phone, hello(b.name)),
      created_at: iso(b.created_at),
      person_id: b.person_id ?? null,
      priority: d === 0 ? 390 : d < 0 ? 370 : 300,
      outcomes: OUTCOMES.booking_confirm,
    };
  });
}

async function restockDemand(): Promise<Item[] | null> {
  const rows = await q(
    `SELECT e.product, count(*) AS views,
            count(DISTINCT COALESCE(v.person_id, 'v:' || v.visitor_id)) AS people,
            count(DISTINCT v.person_id) AS known, max(e.ts) AS last_at,
            mode() WITHIN GROUP (ORDER BY COALESCE(e.props->>'colour', e.props->>'color')) AS colour
     FROM events e JOIN visitors v ON v.visitor_id = e.visitor_id
     WHERE e.name = 'sold_out_view' AND e.ts > now() - interval '30 days' AND e.product IS NOT NULL
       AND ${REAL_VISITOR('v')}
     GROUP BY e.product
     HAVING NOT EXISTS (SELECT 1 FROM inbox_actions a WHERE a.kind = 'restock' AND a.ref = e.product
                        AND a.done_at > now() - interval '30 days')
     ORDER BY people DESC, views DESC`,
  );
  if (!rows) return null;
  return rows.map((r: Row) => {
    const people = Number(r.people), known = Number(r.known);
    return {
      kind: 'restock', ref: r.product,
      title: `Restock ${r.product}${r.colour ? ` (${r.colour})` : ''}`,
      reason: [`${people} ${people === 1 ? 'person' : 'people'} looked while sold out`, `${r.views} views in 30 days`,
        known ? `${known} we can message` : null].filter(Boolean).join(' · '),
      value: null, currency: null, whatsapp: null,
      created_at: iso(r.last_at),
      person_id: null,
      priority: 100 + Math.min(99, people),
      outcomes: OUTCOMES.restock,
    };
  });
}

export const GET: APIRoute = async ({ request }) => {
  if (!(await requestIsAdmin(request))) return json({ error: 'Not authorised' }, 401);

  const fresh = await q<{ at: Date }>('SELECT people_refresh() AS at');   // hot leads read mv_people
  if (!fresh) return json({ error: 'Database unavailable' }, 503);

  const [hot, pay, book, restock] = await Promise.all([hotLeads(), paymentFailures(), bookingsToConfirm(), restockDemand()]);
  if (!hot || !pay || !book || !restock) return json({ error: 'Query failed' }, 500);

  const items = [...pay, ...book, ...hot, ...restock].sort((a, b) => b.priority - a.priority);
  return json({
    as_of: iso(fresh[0]?.at),
    hot_threshold: HOT_THRESHOLD,
    counts: { payment_failed: pay.length, booking_confirm: book.length, hot_lead: hot.length, restock: restock.length, total: items.length },
    items,
  });
};

export const POST: APIRoute = async ({ request }) => {
  const email = await founderEmail(request);
  if (!email) return json({ error: 'Not authorised' }, 401);

  let body: { kind?: string; ref?: string; outcome?: string; note?: string };
  try { body = await request.json(); } catch { return json({ error: 'Bad request' }, 400); }

  const kind = String(body.kind || '') as Kind;
  if (!KINDS.includes(kind)) return json({ error: 'Unknown kind' }, 400);
  const ref = String(body.ref || '').trim();
  if (!ref || ref.length > 220) return json({ error: 'ref is required' }, 400);
  const outcome = String(body.outcome || '').trim().toLowerCase().replace(/\s+/g, '_');
  if (!/^[a-z0-9_]{1,40}$/.test(outcome)) return json({ error: 'outcome is required (a short word, e.g. contacted)' }, 400);
  const note = body.note == null ? null : String(body.note).trim().slice(0, 1000) || null;

  try {
    const out = await tx(async (c) => {
      const r = await c.query(
        `INSERT INTO inbox_actions (kind, ref, done_by, outcome, note) VALUES ($1,$2,$3,$4,$5) RETURNING id, done_at`,
        [kind, ref, email, outcome, note],
      );
      let booking = false;
      if (kind === 'booking_confirm' && BOOKING_OUTCOMES.includes(outcome)) {
        const u = await c.query(`UPDATE bookings SET outcome = $2, outcome_at = now() WHERE booking_id = $1`, [ref, outcome]);
        booking = (u.rowCount ?? 0) > 0;
      }
      return { id: String(r.rows[0].id), done_at: iso(r.rows[0].done_at), booking_updated: booking };
    });
    if (!out) return json({ error: 'Database unavailable' }, 503);
    return json({ ok: true, ...out, done_by: email });
  } catch (e) {
    console.error('[inbox] mark done failed:', e);
    return json({ error: 'Could not save' }, 500);
  }
};
