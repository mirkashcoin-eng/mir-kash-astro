// Affiliate links and the clicks they generate.
//   `affiliates/{slug}` — one per creator; the slug is what appears in /go/{slug}.
//   `clicks/{clickId}`  — one per visit through a /go link. The click id (not the
//     slug) is what rides along to the Shopify order, so the public link never
//     exposes which affiliate a given order belongs to, and a shared/edited URL
//     can't forge attribution — only ids we minted exist in this collection.
// Admin SDK only (service account); never readable from the browser.
import { adminDb } from './firebaseAdmin';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';

// Slugs live in a URL path, so keep them boring: lowercase, digits, hyphens.
export const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;

export interface Affiliate {
  slug: string;
  label: string | null;
  createdAt: string | null;
}

const iso = (t: unknown): string | null =>
  t instanceof Timestamp ? t.toDate().toISOString() : null;

// Create one. Returns 'taken' rather than overwriting an existing creator's link —
// reusing a slug would silently reassign their traffic.
export async function createAffiliate(
  slug: string,
  label?: string,
): Promise<'ok' | 'taken' | 'unavailable'> {
  const db = adminDb();
  if (!db) return 'unavailable';
  const ref = db.collection('affiliates').doc(slug);
  if ((await ref.get()).exists) return 'taken';
  await ref.set({ slug, label: label || null, createdAt: FieldValue.serverTimestamp() });
  return 'ok';
}

export async function getAffiliates(max = 200): Promise<Affiliate[] | null> {
  const db = adminDb();
  if (!db) return null;
  try {
    const snap = await db.collection('affiliates').orderBy('createdAt', 'desc').limit(max).get();
    return snap.docs.map((d) => {
      const v = d.data() as Record<string, unknown>;
      return { slug: d.id, label: (v.label as string) ?? null, createdAt: iso(v.createdAt) };
    });
  } catch {
    return null;
  }
}

// Log a click and hand back its id. Best-effort: if Firestore is unavailable we
// return null and the visitor is still redirected — a lost click beats a dead link.
export async function recordClick(slug: string, landingPath: string): Promise<string | null> {
  const db = adminDb();
  if (!db) return null;
  try {
    const clickId = crypto.randomUUID();
    await db.collection('clicks').doc(clickId).set({
      clickId,
      affiliateId: slug,
      landingPath,
      createdAt: FieldValue.serverTimestamp(),
    });
    return clickId;
  } catch {
    return null;
  }
}

// clickId → affiliate slug, for the ids found on orders. Chunked because Firestore
// caps `in` queries at 30 values.
export async function affiliatesForClicks(clickIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const db = adminDb();
  if (!db || !clickIds.length) return out;
  try {
    for (let i = 0; i < clickIds.length; i += 30) {
      const chunk = clickIds.slice(i, i + 30);
      const snap = await db.collection('clicks').where('clickId', 'in', chunk).get();
      snap.forEach((d) => {
        const v = d.data() as Record<string, unknown>;
        if (v.affiliateId) out.set(d.id, String(v.affiliateId));
      });
    }
  } catch { /* best-effort — unmatched clicks just report as unattributed */ }
  return out;
}

// How many clicks each affiliate has driven, for the conversion-rate column.
export async function clickCounts(): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const db = adminDb();
  if (!db) return out;
  try {
    const snap = await db.collection('clicks').select('affiliateId').get();
    snap.forEach((d) => {
      const id = String((d.data() as Record<string, unknown>).affiliateId || '');
      if (id) out.set(id, (out.get(id) || 0) + 1);
    });
  } catch { /* best-effort */ }
  return out;
}

export interface AffiliateRow extends Affiliate {
  clicks: number;
  orders: number;
  revenue: number;
  currency: string;
  conversionRate: number; // orders ÷ clicks, as a percentage
}

// What each affiliate has actually driven. Orders come from Shopify (authoritative
// for money); the click log only resolves which affiliate an order's click_id
// belongs to. Every affiliate is listed, including ones with no sales yet.
export async function getAffiliateSummary(
  orders: Array<{ clickId: string | null; cancelled: boolean; total: { amount: string; currencyCode: string } | null }>,
): Promise<AffiliateRow[] | null> {
  const affiliates = await getAffiliates();
  if (!affiliates) return null;

  const live = orders.filter((o) => !o.cancelled && o.clickId);
  const bySlug = await affiliatesForClicks(live.map((o) => o.clickId as string));
  const counts = await clickCounts();

  const sales = new Map<string, { orders: number; revenue: number; currency: string }>();
  for (const o of live) {
    const slug = bySlug.get(o.clickId as string);
    if (!slug) continue; // click id we didn't mint, or a purged click
    const acc = sales.get(slug) ?? { orders: 0, revenue: 0, currency: 'INR' };
    acc.orders += 1;
    acc.revenue += Number(o.total?.amount || 0);
    if (o.total?.currencyCode) acc.currency = o.total.currencyCode;
    sales.set(slug, acc);
  }

  return affiliates
    .map((a) => {
      const s = sales.get(a.slug);
      const clicks = counts.get(a.slug) || 0;
      const ordered = s?.orders ?? 0;
      return {
        ...a,
        clicks,
        orders: ordered,
        revenue: s?.revenue ?? 0,
        currency: s?.currency ?? 'INR',
        conversionRate: clicks ? (ordered / clicks) * 100 : 0,
      };
    })
    .sort((a, b) => b.revenue - a.revenue || b.clicks - a.clicks);
}
