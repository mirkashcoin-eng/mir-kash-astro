// First-party, privacy-friendly visitor funnel. No cookies, no PII, no per-user
// records — only anonymous daily aggregate COUNTS per stage, in Firestore
// `analytics_daily/{YYYY-MM-DD}` (IST). Written by /api/track, read by /api/admin/data.
// Uses the Admin SDK (service account), so the collection stays locked from the public.
import { adminDb } from './firebaseAdmin';
import { FieldValue } from 'firebase-admin/firestore';

// The funnel stages, in order. `purchase` is sourced from Shopify orders (authoritative),
// so it is not a tracked event here.
export const FUNNEL_EVENTS = ['visit', 'product_view', 'add_to_cart', 'checkout_start', 'payment_start'] as const;
export type FunnelEvent = (typeof FUNNEL_EVENTS)[number];

// Day bucket in India time so a "day" matches the store's day.
function dayKey(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }); // YYYY-MM-DD
}

// Increment one stage's counter for today, plus that product's own counters when the
// event names one. Best-effort — never throws.
export async function recordEvent(name: string, product?: string): Promise<void> {
  if (!(FUNNEL_EVENTS as readonly string[]).includes(name)) return;
  const db = adminDb();
  if (!db) return;
  try {
    const writes: Promise<unknown>[] = [
      db.collection('analytics_daily').doc(dayKey()).set(
        { [name]: FieldValue.increment(1), total: FieldValue.increment(1), day: dayKey() },
        { merge: true },
      ),
    ];
    // Per-product tally — powers "most viewed products" in /admin. Doc id is a slug of
    // the title so it stays stable and safe as a Firestore key.
    if (product && (name === 'product_view' || name === 'add_to_cart')) {
      const id = product.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 120);
      if (id) {
        writes.push(db.collection('product_stats').doc(id).set({
          title: product,
          [name === 'product_view' ? 'views' : 'cartAdds']: FieldValue.increment(1),
          lastAt: FieldValue.serverTimestamp(),
        }, { merge: true }));
      }
    }
    await Promise.all(writes);
  } catch { /* best-effort analytics; never surface */ }
}

// Booking-prompt (Try at Home / Private Viewing dialog) counters, in the same daily doc.
// Per event: a total plus a split by page kind and by offer, e.g. vp_shown, vp_shown_home,
// vp_shown_tryhome. They are impressions, not unique people: the prompt itself shows at most
// once per visit per page kind. `total` is untouched so the visitor funnel is unaffected.
export const PROMPT_EVENTS = ['vp_shown', 'vp_dismiss', 'vp_click'] as const;
export type PromptEvent = (typeof PROMPT_EVENTS)[number];
export const PROMPT_PAGES = ['home', 'shop', 'product'] as const;
export const PROMPT_OFFERS = ['tryhome', 'viewing'] as const;

export async function recordPromptEvent(name: string, page: string, offer: string): Promise<void> {
  if (!(PROMPT_EVENTS as readonly string[]).includes(name)) return;
  const db = adminDb();
  if (!db) return;
  const inc = () => FieldValue.increment(1);
  const fields: Record<string, unknown> = { [name]: inc(), day: dayKey() };
  if ((PROMPT_PAGES as readonly string[]).includes(page)) fields[`${name}_${page}`] = inc();
  if ((PROMPT_OFFERS as readonly string[]).includes(offer)) fields[`${name}_${offer}`] = inc();
  try {
    await db.collection('analytics_daily').doc(dayKey()).set(fields, { merge: true });
  } catch { /* best-effort analytics; never surface */ }
}

export interface PromptCounts { shown: number; dismiss: number; click: number }
export interface PromptStats {
  days: number;
  all: PromptCounts;
  byPage: Record<(typeof PROMPT_PAGES)[number], PromptCounts>;
  byOffer: Record<(typeof PROMPT_OFFERS)[number], PromptCounts>;
}

// Summed over the last `days` daily docs. null if unavailable, so /admin can degrade.
export async function getPromptStats(days = 30): Promise<PromptStats | null> {
  const db = adminDb();
  if (!db) return null;
  try {
    const snap = await db.collection('analytics_daily').orderBy('day', 'desc').limit(days).get();
    const zero = (): PromptCounts => ({ shown: 0, dismiss: 0, click: 0 });
    const out: PromptStats = {
      days, all: zero(),
      byPage: { home: zero(), shop: zero(), product: zero() },
      byOffer: { tryhome: zero(), viewing: zero() },
    };
    snap.forEach((doc) => {
      const v = doc.data() as Record<string, number>;
      const add = (c: PromptCounts, suffix: string) => {
        c.shown += Number(v[`vp_shown${suffix}`] || 0);
        c.dismiss += Number(v[`vp_dismiss${suffix}`] || 0);
        c.click += Number(v[`vp_click${suffix}`] || 0);
      };
      add(out.all, '');
      for (const p of PROMPT_PAGES) add(out.byPage[p], `_${p}`);
      for (const o of PROMPT_OFFERS) add(out.byOffer[o], `_${o}`);
    });
    return out;
  } catch {
    return null;
  }
}

export interface ProductStat {
  id: string;
  title: string;
  views: number;
  cartAdds: number;
}

// Most-viewed products first. Returns null if unavailable, so /admin can degrade.
export async function getProductStats(max = 20): Promise<ProductStat[] | null> {
  const db = adminDb();
  if (!db) return null;
  try {
    const snap = await db.collection('product_stats').orderBy('views', 'desc').limit(max).get();
    return snap.docs.map((d) => {
      const v = d.data() as Record<string, unknown>;
      return {
        id: d.id,
        title: (v.title as string) || d.id,
        views: Number(v.views || 0),
        cartAdds: Number(v.cartAdds || 0),
      };
    });
  } catch {
    return null;
  }
}

export interface Funnel {
  visit: number;
  product_view: number;
  add_to_cart: number;
  checkout_start: number;
  payment_start: number;
  days: number;
}

// Summed stage counts across the last `days` daily docs. Returns null if unavailable
// (service account not configured or the read fails) so the dashboard can degrade.
export async function getFunnel(days = 30): Promise<Funnel | null> {
  const db = adminDb();
  if (!db) return null;
  try {
    const snap = await db.collection('analytics_daily').orderBy('day', 'desc').limit(days).get();
    const sum: Record<FunnelEvent, number> = { visit: 0, product_view: 0, add_to_cart: 0, checkout_start: 0, payment_start: 0 };
    snap.forEach((doc) => {
      const v = doc.data() as Record<string, number>;
      for (const k of FUNNEL_EVENTS) sum[k] += Number(v[k] || 0);
    });
    return { ...sum, days };
  } catch {
    return null;
  }
}
