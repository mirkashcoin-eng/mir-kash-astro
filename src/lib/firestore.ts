// Firestore lead capture — server-side only. Records every checkout attempt
// (verified phone + address + cart) so we keep leads even when payment is
// abandoned; Shopify still holds the completed orders. Best-effort: if the
// service account isn't configured, or a write fails, it silently no-ops so the
// checkout flow is never blocked. Needs FIREBASE_SERVICE_ACCOUNT (full JSON).
import { cert, getApps, initializeApp, type App } from 'firebase-admin/app';
import { getFirestore, FieldValue, type Firestore } from 'firebase-admin/firestore';

const APP_NAME = 'leads';
const COLLECTION = 'checkouts';

function getEnv(key: string): string {
  if (typeof process !== 'undefined' && process.env && process.env[key]) {
    return process.env[key] as string;
  }
  const meta = import.meta.env as Record<string, string | undefined>;
  return meta[key] ?? '';
}

let db: Firestore | null = null;
let initialized = false;

function getDb(): Firestore | null {
  if (initialized) return db;
  initialized = true;

  const raw = getEnv('FIREBASE_SERVICE_ACCOUNT');
  if (!raw) {
    console.warn('[firestore] FIREBASE_SERVICE_ACCOUNT not set — lead capture disabled.');
    return null;
  }
  try {
    const svc = JSON.parse(raw);
    const existing = getApps().find((a: App) => a.name === APP_NAME);
    const app = existing ?? initializeApp({ credential: cert(svc) }, APP_NAME);
    db = getFirestore(app);
    return db;
  } catch (err) {
    console.error('[firestore] init failed:', err);
    return null;
  }
}

export interface LeadData {
  draftOrderId: string;
  fullName: string;
  email: string;
  phone: string;
  address: { address1: string; address2: string; city: string; province: string; zip: string };
  amount: number;
  currency: string;
  items: Array<{ title: string; qty: number; price: number }>;
}

// Called when the buyer reaches "Pay" — captures the lead with status "initiated".
// Doc id = our orderId so markLeadPaid can update the same record later.
export async function saveLead(orderId: string, data: LeadData): Promise<void> {
  const d = getDb();
  if (!d) return;
  try {
    await d.collection(COLLECTION).doc(orderId).set(
      { orderId, ...data, status: 'initiated', createdAt: FieldValue.serverTimestamp() },
      { merge: true },
    );
  } catch (err) {
    console.error('[firestore] saveLead failed:', err);
  }
}

// Called from finalizeOrder once Cashfree confirms payment → flips the lead to "paid".
export async function markLeadPaid(orderId: string, orderName?: string | null): Promise<void> {
  const d = getDb();
  if (!d) return;
  try {
    await d.collection(COLLECTION).doc(orderId).set(
      { status: 'paid', orderName: orderName ?? null, paidAt: FieldValue.serverTimestamp() },
      { merge: true },
    );
  } catch (err) {
    console.error('[firestore] markLeadPaid failed:', err);
  }
}
