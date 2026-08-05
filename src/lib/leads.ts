// Individual lead capture: one Firestore doc per browser session (`leads/{sessionId}`),
// enriched as the visitor acts — the bags they add to cart, and the phone/email/name
// they enter at checkout. Holds personal data, so it lives ONLY behind the Admin SDK
// (service account); the collection is never public. Read into /admin for follow-up.
import { adminDb } from './firebaseAdmin';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';

export interface LeadInput {
  sessionId: string;
  event: 'add_to_cart' | 'phone';
  phone?: string;
  email?: string;
  name?: string;
  item?: string; // product title (add_to_cart)
  market?: string;
  uid?: string; // Firebase account uid, if signed in
}

// Upsert the session's lead doc. Best-effort — never throws.
export async function recordLead(l: LeadInput): Promise<void> {
  const db = adminDb();
  if (!db || !l.sessionId) return;
  try {
    const ref = db.collection('leads').doc(l.sessionId);
    const snap = await ref.get();
    const now = FieldValue.serverTimestamp();
    const patch: Record<string, unknown> = { sessionId: l.sessionId, lastSeen: now };
    if (!snap.exists) patch.firstSeen = now;
    if (l.event === 'phone') patch.phoneAt = now;
    if (l.event === 'add_to_cart') patch.cartAt = now;
    if (l.phone) patch.phone = l.phone;
    if (l.email) patch.email = l.email;
    if (l.name) patch.name = l.name;
    if (l.uid) patch.uid = l.uid;
    if (l.market) patch.market = l.market;
    if (l.event === 'add_to_cart' && l.item) patch.items = FieldValue.arrayUnion(l.item);
    await ref.set(patch, { merge: true });
  } catch { /* best-effort */ }
}

export interface Lead {
  id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  items: string[];
  market: string | null;
  stage: 'phone' | 'cart';
  firstSeen: string | null;
  lastSeen: string | null;
}

const iso = (t: unknown): string | null =>
  t instanceof Timestamp ? t.toDate().toISOString() : null;

// Most-recently-active leads first. Returns null if the service account isn't set.
export async function getLeads(max = 200): Promise<Lead[] | null> {
  const db = adminDb();
  if (!db) return null;
  try {
    const snap = await db.collection('leads').orderBy('lastSeen', 'desc').limit(max).get();
    return snap.docs.map((d) => {
      const v = d.data() as Record<string, unknown>;
      const items = Array.isArray(v.items) ? (v.items as string[]) : [];
      return {
        id: d.id,
        name: (v.name as string) ?? null,
        phone: (v.phone as string) ?? null,
        email: (v.email as string) ?? null,
        items,
        market: (v.market as string) ?? null,
        stage: v.phone ? 'phone' : 'cart',
        firstSeen: iso(v.firstSeen),
        lastSeen: iso(v.lastSeen),
      };
    });
  } catch {
    return null;
  }
}
