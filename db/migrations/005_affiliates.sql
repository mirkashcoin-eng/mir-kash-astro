-- Affiliate links, the clicks through them, and the newsletter list, in Neon.
-- These lived only in Firestore; the first migration (scripts/migrate-firestore.mjs)
-- covered visitors and daily counters, not these.
--
-- Attribution works as it always has: /go/{slug} mints a click id, the id rides to the
-- Shopify order as the `click_id` note attribute, and the order's click id resolves to
-- an affiliate. Now orders carry that id here too, so the question "which creator sold
-- this" is one join.

CREATE TABLE affiliates (
  slug        text PRIMARY KEY,                 -- the /go/{slug} part of the link
  label       text,                              -- the creator's name, as typed in /admin
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE affiliate_clicks (
  click_id      text PRIMARY KEY,                -- minted by the site; never guessable
  affiliate     text NOT NULL,                   -- affiliates.slug (kept even if the creator is later removed)
  landing_path  text,
  created_at    timestamptz NOT NULL
);
CREATE INDEX affiliate_clicks_aff_idx ON affiliate_clicks (affiliate, created_at);

-- Everyone who signed up in the site footer. Email is the key, lower-cased, as in Firestore.
CREATE TABLE newsletter_signups (
  email       text PRIMARY KEY,
  created_at  timestamptz,
  source      text,
  market      text,
  status      text,
  shopify_ok  boolean
);

-- The click that led to an order (Shopify note attribute `click_id`), set by the order sync.
ALTER TABLE orders ADD COLUMN click_id text;
CREATE INDEX orders_click_idx ON orders (click_id) WHERE click_id IS NOT NULL;

-- One row per creator: links, clicks, orders and sales. Live orders only (not cancelled,
-- not test). Orders whose click id we never minted are left out, as in /admin today.
CREATE VIEW v_affiliates AS
SELECT a.slug, a.label, a.created_at,
       COALESCE(c.clicks, 0)::int AS clicks,
       COALESCE(o.orders, 0)::int AS orders,
       COALESCE(o.revenue_inr, 0) AS revenue_inr
FROM affiliates a
LEFT JOIN (SELECT affiliate, count(*) AS clicks FROM affiliate_clicks GROUP BY affiliate) c ON c.affiliate = a.slug
LEFT JOIN (
  SELECT k.affiliate, count(*) AS orders, sum(COALESCE(od.total_inr, 0)) AS revenue_inr
  FROM orders od JOIN affiliate_clicks k ON k.click_id = od.click_id
  WHERE od.cancelled_at IS NULL AND NOT od.is_test
  GROUP BY k.affiliate
) o ON o.affiliate = a.slug;
