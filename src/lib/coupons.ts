// Coupon redemption ledger for the INDIA store.
//
// India's custom checkout builds a Shopify *draft order* and re-expresses the
// coupon as a manual FIXED_AMOUNT discount (see admin.ts createDraftOrder) —
// Shopify's DraftOrderInput takes no discount code, and there is no "redeem this
// code" mutation. So Shopify's own counter never moves and its "limit total number
// of uses" / "limit one per customer" settings have no effect on India orders.
//
// Shopify stays the source of truth for the RULES (admin.ts getDiscountCodeRules);
// the Neon `coupon_redemptions` table is the source of truth for the COUNT: one row
// per code per order. The (code, order_name) primary key + ON CONFLICT DO NOTHING
// makes recording idempotent, which matters because three independent paths finalize
// the same order (return page, webhook, reconciler).
//
// Server only; never readable from the browser.
// The global store is deliberately excluded — its hosted checkout redeems and
// counts codes itself, so ledgering it too would exhaust codes twice as fast.
import { q } from './db';
import { getDiscountCodeRules } from './shopify/admin';

export interface Redemption {
  code: string;
  orderName: string;
  orderId: string | null;
  email: string | null;
  phone: string | null;
  amount: number;
}

// Identity is normalized on write AND read, or the lookups silently miss.
export const normCode = (c: string): string => c.trim().toUpperCase();
export const normEmail = (e: string | null | undefined): string | null =>
  e ? e.trim().toLowerCase() || null : null;

// Last 10 digits — the same reduction the checkout applies before sending a phone
// to Cashfree, so "+91 98765 43210" and "9876543210" are one customer.
export const normPhone = (p: string | null | undefined): string | null => {
  if (!p) return null;
  const digits = p.replace(/\D/g, '');
  return digits.length >= 10 ? digits.slice(-10) : digits || null;
};

// Record one redemption. Best-effort and idempotent: a duplicate is the success case
// for a webhook/return-page race. A lost ledger row must never fail an order that the
// buyer has already paid for.
export async function recordRedemption(r: Redemption): Promise<void> {
  const code = normCode(r.code);
  if (!code || !r.orderName) return;
  const rows = await q(
    `INSERT INTO coupon_redemptions (code, order_name, order_id, email, phone, amount)
     VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (code, order_name) DO NOTHING`,
    [code, r.orderName, r.orderId ?? null, normEmail(r.email), normPhone(r.phone), r.amount],
  );
  if (!rows) console.error('[coupons] redemption not recorded', code, r.orderName);
}

// How many times we've redeemed this code. Returns 0 when the database is unavailable
// so an outage lets coupons through rather than blocking every sale.
export async function countRedemptions(code: string): Promise<number> {
  const rows = await q<{ n: string }>('SELECT count(*)::text AS n FROM coupon_redemptions WHERE code = $1', [normCode(code)]);
  return rows ? Number(rows[0]?.n ?? 0) : 0;
}

// Has THIS buyer used the code before? Email or phone matching is enough — a fresh
// email still trips on the phone number, which checkout collects either way.
export async function customerHasRedeemed(
  code: string,
  email: string | null,
  phone: string | null,
): Promise<boolean> {
  const c = normCode(code);
  const e = normEmail(email);
  const p = normPhone(phone);
  if (!c || (!e && !p)) return false;
  const rows = await q(
    `SELECT 1 FROM coupon_redemptions
      WHERE code = $1 AND (($2::text IS NOT NULL AND email = $2) OR ($3::text IS NOT NULL AND phone = $3)) LIMIT 1`,
    [c, e, p],
  );
  return Boolean(rows?.length);
}

// ── The gate ───────────────────────────────────────────────────────────────────
// Checks a code against Shopify's configured limits + our ledger. INDIA ONLY —
// never call this for the global store.
//
// The per-customer check needs a buyer, which we only have at order time: a code
// can be applied on /cart long before any email or phone is entered. So the
// apply-discount endpoints call this without a buyer (total cap only) and
// checkout/create calls it with one (both caps). That's why create.ts re-checks
// rather than trusting that apply-discount already passed.
export type CouponBlock = 'exhausted' | 'already-used';

export async function couponLimitBlock(
  code: string,
  buyer?: { email: string | null; phone: string | null },
): Promise<CouponBlock | null> {
  const c = normCode(code);
  if (!c) return null;
  const rules = await getDiscountCodeRules(c);
  if (!rules) return null; // automatic discount, or no code-level limits to enforce

  if (rules.usageLimit != null) {
    const used = rules.asyncUsageCount + (await countRedemptions(c));
    if (used >= rules.usageLimit) return 'exhausted';
  }
  if (rules.appliesOncePerCustomer && buyer) {
    if (await customerHasRedeemed(c, buyer.email, buyer.phone)) return 'already-used';
  }
  return null;
}

export const couponBlockMessage = (b: CouponBlock): string =>
  b === 'already-used'
    ? 'You’ve already used this discount code.'
    : 'This code has already been fully used.';
