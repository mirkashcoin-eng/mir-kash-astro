// Visitor identity + journey. Two layers:
//   `leads/{sessionId}` — one doc per browser session (anonymous `mk_sid`), enriched
//     as the visitor acts: bags added, phone/name/email, delivery address.
//   `people/{phone}`    — the durable person, keyed by normalised phone. A session is
//     linked here the moment a phone number is entered, so every past and future
//     session of that person rolls up into one row with one journey.
// Holds personal data, so it lives ONLY behind the Admin SDK (service account); the
// collections are never public. Read into /admin for follow-up.
import { adminDb } from './firebaseAdmin';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';

export interface CartLine {
  title: string;
  variant: string | null;
  quantity: number;
  price: number;
}
// The live bag at the moment of an add — what's in it and what it's worth.
export interface CartSnapshot {
  total: number;
  currency: string;
  quantity: number;
  lines: CartLine[];
}

export interface LeadInput {
  sessionId: string;
  event: 'visit' | 'page_view' | 'product_view' | 'add_to_cart' | 'phone' | 'address';
  phone?: string;
  email?: string;
  name?: string;
  item?: string; // product title (add_to_cart)
  market?: string;
  uid?: string; // Firebase account uid, if signed in
  // Delivery address (address event)
  address1?: string;
  city?: string;
  province?: string;
  pin?: string;
  cart?: CartSnapshot; // full bag (add_to_cart)
  // Acquisition, sent on the first hit of a session only.
  referrer?: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  landing?: string;
  page?: string;    // path of the page just loaded (page_view)
  bot?: string;     // crawler name, '' for humans
  country?: string; // ISO code from the CDN edge
}

// Where a visit came from, as one readable label. UTM wins over the referring
// domain because it's what we deliberately tagged; bare domains get tidied.
export function sourceLabel(v: Record<string, unknown>): string | null {
  const utm = (v.utmSource as string) || '';
  if (utm) {
    const campaign = (v.utmCampaign as string) || '';
    return campaign ? `${utm} · ${campaign}` : utm;
  }
  const ref = (v.referrer as string) || '';
  if (!ref) return null;
  try {
    const host = new URL(ref).hostname.replace(/^www\./, '');
    const known: Record<string, string> = {
      'instagram.com': 'Instagram', 'l.instagram.com': 'Instagram',
      'facebook.com': 'Facebook', 'm.facebook.com': 'Facebook', 'l.facebook.com': 'Facebook',
      'google.com': 'Google', 'google.co.in': 'Google',
      'pinterest.com': 'Pinterest', 'in.pinterest.com': 'Pinterest',
      'linkedin.com': 'LinkedIn', 'lnkd.in': 'LinkedIn',
      't.co': 'X/Twitter', 'youtube.com': 'YouTube',
    };
    return known[host] || host;
  } catch {
    return null;
  }
}

// Person key: digits only, last 10 (so +91XXXXXXXXXX, 91XXXXXXXXXX and XXXXXXXXXX
// all collapse to the same person). Returns '' when there's nothing usable.
export function personKey(phone: string | null | undefined): string {
  const d = String(phone ?? '').replace(/[^0-9]/g, '');
  return d.length >= 10 ? d.slice(-10) : '';
}

// Upsert the session's lead doc, and link it to the person once a phone is known.
// Best-effort — never throws.
export async function recordLead(l: LeadInput): Promise<void> {
  const db = adminDb();
  if (!db || !l.sessionId) return;
  try {
    const ref = db.collection('leads').doc(l.sessionId);
    const snap = await ref.get();
    const now = FieldValue.serverTimestamp();
    const patch: Record<string, unknown> = { sessionId: l.sessionId, lastSeen: now };
    if (!snap.exists) {
      patch.firstSeen = now;
      // First touch only — a later direct visit must not erase how they found us.
      if (l.referrer) patch.referrer = l.referrer;
      if (l.utmSource) patch.utmSource = l.utmSource;
      if (l.utmMedium) patch.utmMedium = l.utmMedium;
      if (l.utmCampaign) patch.utmCampaign = l.utmCampaign;
      if (l.landing) patch.landing = l.landing;
      if (l.bot) patch.bot = l.bot;
      if (l.country) patch.country = l.country;
    }
    if (l.event === 'phone') patch.phoneAt = now;
    if (l.event === 'add_to_cart') patch.cartAt = now;
    if (l.event === 'address') patch.addressAt = now;
    if (l.phone) patch.phone = l.phone;
    if (l.email) patch.email = l.email;
    if (l.name) patch.name = l.name;
    if (l.uid) patch.uid = l.uid;
    if (l.market) patch.market = l.market;
    if (l.address1) patch.address1 = l.address1;
    if (l.city) patch.city = l.city;
    if (l.province) patch.province = l.province;
    if (l.pin) patch.pin = l.pin;
    if (l.event === 'add_to_cart' && l.item) patch.items = FieldValue.arrayUnion(l.item);
    // Distinct products seen — arrayUnion dedupes, so the length is the product count.
    // `viewed` is a set and has no order, so the latest is kept separately.
    if (l.event === 'product_view' && l.item) {
      patch.viewedAt = now;
      patch.viewed = FieldValue.arrayUnion(l.item);
      patch.lastViewed = l.item;
    }
    // Distinct pages seen. Also a set, so it's bounded by the size of the site
    // rather than by how much someone browses.
    if (l.event === 'page_view' && l.page) {
      patch.pages = FieldValue.arrayUnion(l.page);
      patch.pageViews = FieldValue.increment(1);
      patch.lastPage = l.page;
    }
    // Latest bag wins — it already includes everything added before it.
    if (l.cart) { patch.cart = l.cart; patch.cartValue = l.cart.total; patch.cartCurrency = l.cart.currency; }
    await ref.set(patch, { merge: true });

    // Link this session to a person. Identified people are keyed by phone; everyone
    // else gets an anonymous person keyed by session id, so cart-adders who never
    // leave a number are still visible (and get folded in later if they do).
    const known = (l.phone as string) || ((snap.data() as Record<string, unknown> | undefined)?.phone as string) || '';
    const key = personKey(known);
    if (key) {
      // Identity just became known — absorb the anonymous record for this session.
      await mergeAnonInto(db, key, l.sessionId);
      await linkPerson(db, key, l, known, now);
    } else {
      await linkPerson(db, ANON_PREFIX + l.sessionId, l, '', now);
    }
  } catch { /* best-effort */ }
}

// Anonymous people are keyed `anon:{sessionId}` so they can never collide with a
// 10-digit phone key.
export const ANON_PREFIX = 'anon:';

// Fold an anonymous person into the now-known phone identity, then delete it, so one
// human is never two rows. Carries over only what the anon record uniquely holds.
async function mergeAnonInto(
  db: FirebaseFirestore.Firestore,
  key: string,
  sessionId: string,
): Promise<void> {
  const anonRef = db.collection('people').doc(ANON_PREFIX + sessionId);
  const anon = await anonRef.get();
  if (!anon.exists) return;
  const v = anon.data() as Record<string, unknown>;
  const carry: Record<string, unknown> = {};
  // firstSeen from the anon record is earlier by definition — it started the journey.
  if (v.firstSeen) carry.firstSeen = v.firstSeen;
  if (v.cartAt) carry.cartAt = v.cartAt;
  if (v.cart) { carry.cart = v.cart; carry.cartValue = v.cartValue; carry.cartCurrency = v.cartCurrency; }
  if (Array.isArray(v.items) && v.items.length) carry.items = FieldValue.arrayUnion(...(v.items as string[]));
  if (Array.isArray(v.viewed) && v.viewed.length) carry.viewed = FieldValue.arrayUnion(...(v.viewed as string[]));
  if (v.viewedAt) carry.viewedAt = v.viewedAt;
  if (Array.isArray(v.pages) && v.pages.length) carry.pages = FieldValue.arrayUnion(...(v.pages as string[]));
  if (v.pageViews) carry.pageViews = FieldValue.increment(Number(v.pageViews) || 0);
  // The anon record holds the true first touch — it started the journey.
  for (const k of ['referrer', 'utmSource', 'utmMedium', 'utmCampaign', 'landing', 'country']) {
    if (v[k]) carry[k] = v[k];
  }
  if (v.cartAdds) carry.cartAdds = FieldValue.increment(Number(v.cartAdds) || 0);
  if (Object.keys(carry).length) await db.collection('people').doc(key).set(carry, { merge: true });
  await anonRef.delete();
}

// Upsert `people/{key}` and attach the session. Counters are incremented per event so
// the People table can show "3 visits, 2 cart adds" without re-reading every session.
async function linkPerson(
  db: FirebaseFirestore.Firestore,
  key: string,
  l: LeadInput,
  phone: string,
  now: FirebaseFirestore.FieldValue,
): Promise<void> {
  const ref = db.collection('people').doc(key);
  const snap = await ref.get();
  const patch: Record<string, unknown> = {
    lastSeen: now,
    sessionIds: FieldValue.arrayUnion(l.sessionId),
  };
  if (phone) patch.phone = phone;          // absent while still anonymous
  if (!snap.exists) {
    patch.firstSeen = now;
    patch.source = 'web';
    // How this person first found us — never overwritten on later visits.
    if (l.referrer) patch.referrer = l.referrer;
    if (l.utmSource) patch.utmSource = l.utmSource;
    if (l.utmMedium) patch.utmMedium = l.utmMedium;
    if (l.utmCampaign) patch.utmCampaign = l.utmCampaign;
    if (l.landing) patch.landing = l.landing;
    if (l.bot) patch.bot = l.bot;
    if (l.country) patch.country = l.country;
  }
  if (l.email) patch.email = l.email;
  if (l.name) patch.name = l.name;
  if (l.market) patch.market = l.market;
  if (l.event === 'visit' && !snap.exists) patch.visitAt = now;
  // `viewed` is a set, so it has no order — keep the latest separately.
  if (l.event === 'product_view' && l.item) {
    patch.viewedAt = now;
    patch.viewed = FieldValue.arrayUnion(l.item);
    patch.lastViewed = l.item;
  }
  if (l.event === 'page_view' && l.page) {
    patch.pages = FieldValue.arrayUnion(l.page);
    patch.pageViews = FieldValue.increment(1);
    patch.lastPage = l.page;
  }
  if (l.event === 'phone') patch.phoneAt = now;
  if (l.event === 'add_to_cart') {
    patch.cartAt = now;
    patch.cartAdds = FieldValue.increment(1);
    if (l.item) patch.items = FieldValue.arrayUnion(l.item);
    if (l.cart) { patch.cart = l.cart; patch.cartValue = l.cart.total; patch.cartCurrency = l.cart.currency; }
  }
  if (l.event === 'address') {
    patch.addressAt = now;
    if (l.address1) patch.address1 = l.address1;
    if (l.city) patch.city = l.city;
    if (l.province) patch.province = l.province;
    if (l.pin) patch.pin = l.pin;
  }
  await ref.set(patch, { merge: true });
}

// ── Reading: people + journeys ───────────────────────────────────────────────

export type Stage = 'visited' | 'cart' | 'phone' | 'address' | 'payment' | 'ordered';

export interface Person {
  id: string;                 // normalised phone key
  name: string | null;
  phone: string | null;
  email: string | null;
  items: string[];
  viewed: string[];           // distinct product pages opened
  cart: CartSnapshot | null;  // their bag: lines + value
  cartValue: number;
  cartCurrency: string;
  address: string | null;     // one-line, for the table
  market: string | null;
  stage: Stage;               // furthest step reached (before order/payment overlay)
  source: string | null;      // 'web' | 'legacy-checkout'
  sessionIds: string[];
  visits: number;
  cartAdds: number;
  firstSeen: string | null;
  lastSeen: string | null;
  // When each step was first reached — powers the day-by-day funnel grid in /admin.
  viewedAt: string | null;
  cartAt: string | null;
  phoneAt: string | null;
  addressAt: string | null;
  // Acquisition (first touch).
  referrer: string | null;
  sourceLabel: string | null;  // readable: 'Instagram', 'priya · diwali'
  landing: string | null;      // first page they hit
  lastViewed: string | null;   // most recent product page opened
  pages: string[];             // distinct paths visited
  pageViews: number;           // total page loads, including repeats
  lastPage: string | null;
  bot: string | null;          // crawler name; null for real visitors
  country: string | null;
}

const iso = (t: unknown): string | null =>
  t instanceof Timestamp ? t.toDate().toISOString() : null;

const oneLine = (v: Record<string, unknown>): string | null =>
  [v.address1, v.city, v.province, v.pin].filter(Boolean).join(', ') || null;

// Furthest stage this person's own data proves. Payment/ordered are overlaid later in
// the API from Shopify (drafts/orders), which is the authoritative source for those.
function stageOf(v: Record<string, unknown>): Stage {
  if (v.addressAt || v.address1) return 'address';
  if (v.phoneAt || v.phone) return 'phone';
  if (v.cartAt) return 'cart';
  return 'visited';
}

// Most-recently-active people first. Returns null if the service account isn't set.
export async function getPeople(max = 500): Promise<Person[] | null> {
  const db = adminDb();
  if (!db) return null;
  try {
    const snap = await db.collection('people').orderBy('lastSeen', 'desc').limit(max).get();
    return snap.docs.map((d) => {
      const v = d.data() as Record<string, unknown>;
      const sessionIds = Array.isArray(v.sessionIds) ? (v.sessionIds as string[]) : [];
      return {
        id: d.id,
        name: (v.name as string) ?? null,
        phone: (v.phone as string) ?? null,
        email: (v.email as string) ?? null,
        items: Array.isArray(v.items) ? (v.items as string[]) : [],
        // A product in the bag was necessarily seen, so union the two — otherwise
        // sessions predating product_view tracking would report 0 products viewed.
        viewed: [...new Set([
          ...(Array.isArray(v.viewed) ? (v.viewed as string[]) : []),
          ...(Array.isArray(v.items) ? (v.items as string[]) : []),
        ])],
        cart: (v.cart as CartSnapshot) ?? null,
        cartValue: Number(v.cartValue || 0),
        cartCurrency: (v.cartCurrency as string) || 'INR',
        address: oneLine(v),
        market: (v.market as string) ?? null,
        stage: stageOf(v),
        source: (v.source as string) ?? null,
        sessionIds,
        visits: Math.max(sessionIds.length, 1),
        cartAdds: Number(v.cartAdds || 0),
        firstSeen: iso(v.firstSeen),
        lastSeen: iso(v.lastSeen),
        viewedAt: iso(v.viewedAt),
        cartAt: iso(v.cartAt),
        phoneAt: iso(v.phoneAt),
        addressAt: iso(v.addressAt),
        referrer: (v.referrer as string) ?? null,
        sourceLabel: sourceLabel(v),
        landing: (v.landing as string) ?? null,
        lastViewed: (v.lastViewed as string) ?? null,
        pages: Array.isArray(v.pages) ? (v.pages as string[]) : [],
        pageViews: Number(v.pageViews || 0),
        lastPage: (v.lastPage as string) ?? null,
        bot: (v.bot as string) ?? null,
        country: (v.country as string) ?? null,
      };
    });
  } catch {
    return null;
  }
}

export interface JourneyStep {
  at: string | null;
  type: 'first_seen' | 'cart' | 'phone' | 'address' | 'last_seen';
  detail: string | null;
  session: string;
}

// One person's full timeline, stitched from every session ever linked to them.
// Chronological. Returns [] when unavailable.
export async function getPersonJourney(id: string): Promise<JourneyStep[]> {
  const db = adminDb();
  if (!db) return [];
  try {
    const person = await db.collection('people').doc(id).get();
    if (!person.exists) return [];
    const ids = (person.data()?.sessionIds as string[]) || [];
    const steps: JourneyStep[] = [];
    // Firestore `in` queries cap at 30 values — chunk the session ids.
    for (let i = 0; i < ids.length; i += 30) {
      const chunk = ids.slice(i, i + 30);
      const snap = await db.collection('leads').where('sessionId', 'in', chunk).get();
      snap.forEach((d) => {
        const v = d.data() as Record<string, unknown>;
        const s = d.id;
        const items = Array.isArray(v.items) ? (v.items as string[]) : [];
        if (v.firstSeen) steps.push({ at: iso(v.firstSeen), type: 'first_seen', detail: 'Visited the site', session: s });
        if (v.cartAt) {
          const c = v.cart as CartSnapshot | undefined;
          const bag = c?.lines?.length
            ? c.lines.map((x) => `${x.quantity}× ${x.title}`).join(', ') + ` — ${c.currency} ${Math.round(c.total)}`
            : (items.length ? items.join(', ') : 'Added to bag');
          steps.push({ at: iso(v.cartAt), type: 'cart', detail: bag, session: s });
        }
        if (v.phoneAt) steps.push({ at: iso(v.phoneAt), type: 'phone', detail: (v.phone as string) || 'Entered phone', session: s });
        if (v.addressAt) steps.push({ at: iso(v.addressAt), type: 'address', detail: oneLine(v) || 'Entered address', session: s });
      });
    }
    return steps.sort((a, b) => new Date(a.at || 0).getTime() - new Date(b.at || 0).getTime());
  } catch {
    return [];
  }
}

