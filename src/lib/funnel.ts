// Immutable per-day funnel counts, in Firestore `funnel_daily/{YYYY-MM-DD}` (IST).
// Written once, the first time each person reaches each step (from linkPerson in
// ./leads), and read straight by /admin's Daily funnel grid. This exists because
// the grid used to be computed client-side from getPeople(500) — a live, capped,
// re-sortable list — so historical columns silently shrank as old visitors scrolled
// out of the window. A day's counter, once written, never moves.
//
// Each step is tracked in three buckets so /admin can toggle them:
//   <step>          — real humans
//   bot_<step>      — crawlers (l.bot set)
//   hidden_<step>   — the internal / test numbers in HIDDEN_PERSON_KEYS
import { adminDb } from './firebaseAdmin';
import { FieldValue } from 'firebase-admin/firestore';

type Db = NonNullable<ReturnType<typeof adminDb>>;
type LeadLike = { event: string; item?: string; bot?: string };

// People whose activity is kept out of every count by default. Keys are the same
// last-10-digits form personKey() produces, so they match the people doc id.
export const HIDDEN_PERSON_KEYS = new Set<string>(['7738784781', '8306883773']);

// The funnel steps, in order. `visitors` is the first touch; p1/p2/p3 are the days
// a person reached their 1st / 2nd / 3rd distinct product view (cumulative
// milestones, so column totals form a real funnel); cart/phone/address are the
// first time each of those was entered.
export const FUNNEL_STEPS = ['visitors', 'p1', 'p2', 'p3', 'cart', 'phone', 'address'] as const;

export function istDayKey(d: Date = new Date()): string {
  return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }); // YYYY-MM-DD
}

function bucketPrefix(key: string, bot: boolean): string {
  if (HIDDEN_PERSON_KEYS.has(key)) return 'hidden_';
  return bot ? 'bot_' : '';
}

// Records whichever steps this event is the FIRST to complete for `key`, against
// today's IST day. `wasNew` = the people doc did not exist before this write;
// `prev` = its data *before* it (so we can tell a first cart-add from a repeat).
// Best-effort — never throws.
export async function recordMilestones(
  db: Db,
  key: string,
  l: LeadLike,
  wasNew: boolean,
  prev: Record<string, unknown>,
): Promise<void> {
  const pfx = bucketPrefix(key, Boolean(l.bot || prev.bot));
  const inc: Record<string, unknown> = {};
  const bump = (step: string) => { inc[pfx + step] = FieldValue.increment(1); };

  if (wasNew) bump('visitors');

  if (l.event === 'product_view' && l.item) {
    const seen = Array.isArray(prev.viewed) ? (prev.viewed as string[]) : [];
    if (!seen.includes(l.item)) {
      const nth = seen.length + 1;
      if (nth === 1) bump('p1');
      else if (nth === 2) bump('p2');
      else if (nth === 3) bump('p3');
    }
  }
  if (l.event === 'add_to_cart' && !prev.cartAt) bump('cart');
  if (l.event === 'phone' && !prev.phoneAt) bump('phone');
  if (l.event === 'address' && !prev.addressAt) bump('address');

  if (!Object.keys(inc).length) return;
  const day = istDayKey();
  inc.day = day;
  try {
    await db.collection('funnel_daily').doc(day).set(inc, { merge: true });
  } catch (e) {
    console.error('[funnel] milestone write failed:', e);
  }
}

// The last `days` day-docs, newest first, as { 'YYYY-MM-DD': { visitors, p1, … } }.
// ~8 months, enough for /admin to page back through months without another read
// (docs only exist for days with activity, so this is far fewer than `days` rows).
// Returns null when the service account isn't configured, so the dashboard degrades.
export async function getFunnelDaily(days = 240): Promise<Record<string, Record<string, number>> | null> {
  const db = adminDb();
  if (!db) return null;
  try {
    const snap = await db.collection('funnel_daily').orderBy('day', 'desc').limit(days).get();
    const out: Record<string, Record<string, number>> = {};
    snap.forEach((doc) => {
      const v = doc.data() as Record<string, unknown>;
      const row: Record<string, number> = {};
      for (const k of Object.keys(v)) {
        if (k === 'day') continue;
        row[k] = Number(v[k] || 0);
      }
      out[doc.id] = row;
    });
    return out;
  } catch (e) {
    console.error('[funnel] getFunnelDaily failed:', e);
    return null;
  }
}
