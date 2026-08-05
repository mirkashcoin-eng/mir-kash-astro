// First-party, privacy-friendly visitor funnel. No cookies, no PII, no per-user
// records — only anonymous daily aggregate COUNTS per stage, stored in Firestore
// `analytics_daily/{YYYY-MM-DD}` (IST). Written by /api/track, read by /api/admin/data.
// Requires a Firestore rule allowing this collection (see .env.example).
import { initializeApp, getApps, getApp, type FirebaseApp } from 'firebase/app';
import {
  initializeFirestore, getFirestore, doc, setDoc, increment,
  collection, query, orderBy, limit as fbLimit, getDocs, type Firestore,
} from 'firebase/firestore';

function env(k: string): string {
  if (typeof process !== 'undefined' && process.env && process.env[k]) return process.env[k] as string;
  const m = import.meta.env as Record<string, string | undefined>;
  return m[k] ?? '';
}

// The funnel stages, in order. `purchase` is sourced from Shopify orders (authoritative),
// so it is not a tracked event here.
export const FUNNEL_EVENTS = ['visit', 'product_view', 'add_to_cart', 'checkout_start', 'payment_start'] as const;
export type FunnelEvent = (typeof FUNNEL_EVENTS)[number];

let _db: Firestore | undefined;
function db(): Firestore | null {
  const apiKey = env('PUBLIC_FIREBASE_API_KEY');
  const projectId = env('PUBLIC_FIREBASE_PROJECT_ID');
  if (!apiKey || !projectId) return null;
  if (_db) return _db;
  const cfg = { apiKey, projectId, authDomain: env('PUBLIC_FIREBASE_AUTH_DOMAIN'), appId: env('PUBLIC_FIREBASE_APP_ID') };
  const app: FirebaseApp = getApps().length ? getApp() : initializeApp(cfg);
  try { _db = initializeFirestore(app, { experimentalForceLongPolling: true }); }
  catch { _db = getFirestore(app); }
  return _db;
}

// Day bucket in India time so a "day" matches the store's day.
function dayKey(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }); // YYYY-MM-DD
}

// Increment one stage's counter for today. Best-effort — never throws.
export async function recordEvent(name: string): Promise<void> {
  if (!(FUNNEL_EVENTS as readonly string[]).includes(name)) return;
  const d = db();
  if (!d) return;
  try {
    await setDoc(
      doc(d, 'analytics_daily', dayKey()),
      { [name]: increment(1), total: increment(1), day: dayKey() },
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
// (Firebase not configured or the read is denied) so the dashboard can degrade.
export async function getFunnel(days = 30): Promise<Funnel | null> {
  const d = db();
  if (!d) return null;
  try {
    const snap = await getDocs(query(collection(d, 'analytics_daily'), orderBy('day', 'desc'), fbLimit(days)));
    const sum: Record<FunnelEvent, number> = { visit: 0, product_view: 0, add_to_cart: 0, checkout_start: 0, payment_start: 0 };
    snap.forEach((s) => {
      const v = s.data() as Record<string, number>;
      for (const k of FUNNEL_EVENTS) sum[k] += Number(v[k] || 0);
    });
    return { ...sum, days };
  } catch {
    return null;
  }
}
