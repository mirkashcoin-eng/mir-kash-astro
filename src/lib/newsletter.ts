// Newsletter subscribers, stored in Firestore (the `newsletter` collection) via the
// Admin SDK. This is the source of truth for the founders' list: every valid signup
// is written here regardless of whether the Shopify half succeeds, so an email is
// never lost. Creating the Shopify customer + marketing consent (see
// `subscribeEmail` in ./shopify/admin) is best-effort and needs the `write_customers`
// scope on the India Admin app — `shopifyOk` records whether that worked.
// Degrades to null / false when FIREBASE_SERVICE_ACCOUNT isn't set.
import { adminDb } from './firebaseAdmin';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';

export interface Subscriber {
  email: string;
  createdAt: string | null;
  source: string;
  market: string | null;
  shopifyOk: boolean;
}

const iso = (t: unknown): string | null =>
  t instanceof Timestamp ? t.toDate().toISOString() : null;

// Records (or refreshes) one subscriber. Doc id is the lowercased email — emails
// never contain '/', the only character Firestore forbids in a doc id — so a repeat
// signup updates the same doc rather than creating a duplicate.
export async function recordSubscriber(
  email: string,
  opts: { source?: string; market?: string; shopifyOk: boolean },
): Promise<boolean> {
  const db = adminDb();
  if (!db) return false;
  const key = email.trim().toLowerCase();
  if (!key) return false;
  try {
    const ref = db.collection('newsletter').doc(key);
    const snap = await ref.get();
    const now = FieldValue.serverTimestamp();
    const patch: Record<string, unknown> = {
      email: key,
      updatedAt: now,
      status: 'subscribed',
      shopifyOk: opts.shopifyOk,
    };
    if (!snap.exists) {
      patch.createdAt = now;
      patch.source = opts.source || 'footer';
      if (opts.market) patch.market = opts.market;
    }
    await ref.set(patch, { merge: true });
    return true;
  } catch (e) {
    console.error('[newsletter] recordSubscriber failed:', e);
    return false;
  }
}

// Newest signups first. Returns null when the service account isn't configured.
export async function getSubscribers(max = 1000): Promise<Subscriber[] | null> {
  const db = adminDb();
  if (!db) return null;
  try {
    const snap = await db.collection('newsletter').orderBy('createdAt', 'desc').limit(max).get();
    return snap.docs.map((d) => {
      const v = d.data() as Record<string, unknown>;
      return {
        email: (v.email as string) || d.id,
        createdAt: iso(v.createdAt),
        source: (v.source as string) || 'footer',
        market: (v.market as string) ?? null,
        shopifyOk: Boolean(v.shopifyOk),
      };
    });
  } catch (e) {
    console.error('[newsletter] getSubscribers failed:', e);
    return null;
  }
}
