// Newsletter subscribers, in Neon (`newsletter_signups`). This is the source of truth for
// the founders' list: every valid signup is written here regardless of whether the Shopify
// half succeeds, so an email is never lost. Creating the Shopify customer + marketing
// consent (see `subscribeEmail` in ./shopify/admin) is best-effort and needs the
// `write_customers` scope on the India Admin app — `shopifyOk` records whether that worked.
import { q } from './db';

export interface Subscriber {
  email: string;
  createdAt: string | null;
  source: string;
  market: string | null;
  shopifyOk: boolean;
}

// Records (or refreshes) one subscriber. The key is the lowercased email, so a repeat
// signup updates the same row rather than creating a duplicate.
export async function recordSubscriber(
  email: string,
  opts: { source?: string; market?: string; shopifyOk: boolean },
): Promise<boolean> {
  const key = email.trim().toLowerCase();
  if (!key) return false;
  const rows = await q(
    `INSERT INTO newsletter_signups (email, created_at, source, market, status, shopify_ok)
     VALUES ($1, now(), $2, $3, 'subscribed', $4)
     ON CONFLICT (email) DO UPDATE SET status = 'subscribed', shopify_ok = EXCLUDED.shopify_ok
     RETURNING email`,
    [key, opts.source || 'footer', opts.market ?? null, opts.shopifyOk],
  );
  return Boolean(rows);
}

// Newest signups first. Returns null when the database isn't reachable.
export async function getSubscribers(): Promise<Subscriber[] | null> {
  const rows = await q<{ email: string; created_at: Date | null; source: string | null; market: string | null; shopify_ok: boolean | null }>(
    'SELECT email, created_at, source, market, shopify_ok FROM newsletter_signups ORDER BY created_at DESC NULLS LAST',
  );
  if (!rows) return null;
  return rows.map((r) => ({
    email: r.email,
    createdAt: r.created_at ? r.created_at.toISOString() : null,
    source: r.source || 'footer',
    market: r.market,
    shopifyOk: Boolean(r.shopify_ok),
  }));
}
