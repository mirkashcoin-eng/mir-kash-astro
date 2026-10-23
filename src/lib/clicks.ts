// Affiliate links and the clicks they generate, in Neon (`affiliates`, `affiliate_clicks`;
// see db/migrations/005_affiliates.sql).
//   `affiliates`        — one per creator; the slug is what appears in /go/{slug}.
//   `affiliate_clicks`  — one per visit through a /go link. The click id (not the
//     slug) is what rides along to the Shopify order, so the public link never
//     exposes which affiliate a given order belongs to, and a shared/edited URL
//     can't forge attribution — only ids we minted exist in this table.
// Orders carry the click id as `orders.click_id` (set by the Shopify order sync), so
// "what did each creator sell" is one join: the `v_affiliates` view.
import { q } from './db';

// Slugs live in a URL path, so keep them boring: lowercase, digits, hyphens.
export const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;

export interface Affiliate {
  slug: string;
  label: string | null;
  createdAt: string | null;
}

// Create one. Returns 'taken' rather than overwriting an existing creator's link —
// reusing a slug would silently reassign their traffic.
export async function createAffiliate(
  slug: string,
  label?: string,
): Promise<'ok' | 'taken' | 'unavailable'> {
  const rows = await q(
    'INSERT INTO affiliates (slug, label) VALUES ($1, $2) ON CONFLICT (slug) DO NOTHING RETURNING slug',
    [slug, label || null],
  );
  if (!rows) return 'unavailable';
  return rows.length ? 'ok' : 'taken';
}

// Log a click and hand back its id. Best-effort: if the database is unavailable we
// return null and the visitor is still redirected — a lost click beats a dead link.
export async function recordClick(slug: string, landingPath: string): Promise<string | null> {
  const clickId = crypto.randomUUID();
  const rows = await q(
    'INSERT INTO affiliate_clicks (click_id, affiliate, landing_path, created_at) VALUES ($1, $2, $3, now()) RETURNING click_id',
    [clickId, slug, landingPath.slice(0, 300)],
  );
  return rows ? clickId : null;
}

export interface AffiliateRow extends Affiliate {
  clicks: number;
  orders: number;
  revenue: number;
  currency: string;
  conversionRate: number; // orders ÷ clicks, as a percentage
}

// What each affiliate has driven: clicks, live orders and revenue (INR, both stores
// converted). Every affiliate is listed, including ones with no sales yet.
export async function getAffiliateSummary(): Promise<AffiliateRow[] | null> {
  const rows = await q<{ slug: string; label: string | null; created_at: Date | null; clicks: number; orders: number; revenue_inr: string }>(
    'SELECT slug, label, created_at, clicks, orders, revenue_inr FROM v_affiliates',
  );
  if (!rows) return null;
  return rows
    .map((r) => {
      const orders = Number(r.orders), clicks = Number(r.clicks);
      return {
        slug: r.slug,
        label: r.label,
        createdAt: r.created_at ? r.created_at.toISOString() : null,
        clicks,
        orders,
        revenue: Number(r.revenue_inr),
        currency: 'INR',
        conversionRate: clicks ? (orders / clicks) * 100 : 0,
      };
    })
    .sort((a, b) => b.revenue - a.revenue || b.clicks - a.clicks);
}
