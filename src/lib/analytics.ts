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

// Increment one stage's counter for today. Best-effort — never throws.
export async function recordEvent(name: string): Promise<void> {
  if (!(FUNNEL_EVENTS as readonly string[]).includes(name)) return;
  const db = adminDb();
  if (!db) return;
  try {
    await db.collection('analytics_daily').doc(dayKey()).set(
      { [name]: FieldValue.increment(1), total: FieldValue.increment(1), day: dayKey() },
      { merge: true },
    );
  } catch { /* best-effort analytics; never surface */ }
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
