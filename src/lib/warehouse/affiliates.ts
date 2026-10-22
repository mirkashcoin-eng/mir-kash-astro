// Neon copies of the affiliate and newsletter records. Firestore stays the first write
// (and what /admin still reads for these two lists); each function here is a
// best-effort second write so Neon has them too. Never throws, never blocks a redirect
// or a signup for long.
import { q } from '../db';

export async function mirrorAffiliate(slug: string, label: string | null): Promise<void> {
  await q(
    `INSERT INTO affiliates (slug, label) VALUES ($1, $2)
     ON CONFLICT (slug) DO UPDATE SET label = COALESCE(EXCLUDED.label, affiliates.label)`,
    [slug, label],
  );
}

export async function mirrorClick(clickId: string, affiliate: string, landingPath: string): Promise<void> {
  await q(
    `INSERT INTO affiliate_clicks (click_id, affiliate, landing_path, created_at) VALUES ($1, $2, $3, now())
     ON CONFLICT (click_id) DO NOTHING`,
    [clickId, affiliate, landingPath.slice(0, 300)],
  );
}

export async function mirrorSubscriber(
  email: string,
  opts: { source?: string; market?: string; shopifyOk: boolean },
): Promise<void> {
  await q(
    `INSERT INTO newsletter_signups (email, created_at, source, market, status, shopify_ok)
     VALUES ($1, now(), $2, $3, 'subscribed', $4)
     ON CONFLICT (email) DO UPDATE SET status = 'subscribed', shopify_ok = EXCLUDED.shopify_ok`,
    [email, opts.source || 'footer', opts.market ?? null, opts.shopifyOk],
  );
}
