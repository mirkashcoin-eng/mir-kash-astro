-- Shopify mirror: what the orders / returns / bookings sync (src/lib/warehouse/*,
-- /api/cron/sync-shopify) needs on top of 001_core.

-- orders.updated_at is Shopify's updatedAt (the sync's watermark); synced_at is when
-- we last wrote the row. shop_* is the total in the store's own currency (INR for
-- India, USD for Global) — what total_inr is converted from, and kept so a missing
-- conversion can be filled later. is_test = Shopify's own test-order flag.
ALTER TABLE orders
  ADD COLUMN shop_currency text,
  ADD COLUMN shop_total    numeric(12,2),
  ADD COLUMN is_test       boolean NOT NULL DEFAULT false,
  ADD COLUMN synced_at     timestamptz NOT NULL DEFAULT now();
CREATE INDEX orders_store_updated_idx ON orders (store, updated_at);

-- 'portal' = asked for on our returns page / account (order tagged return-requested);
-- 'shopify' = a Return opened in Shopify itself. status: 'requested' for portal rows,
-- Shopify's ReturnStatus (OPEN, CLOSED, DECLINED, CANCELED…) otherwise.
ALTER TABLE returns
  ADD COLUMN source text NOT NULL DEFAULT 'portal',
  ADD COLUMN status text;
CREATE INDEX returns_order_idx ON returns (order_id);
CREATE INDEX returns_created_idx ON returns (created_at);

-- status 'deleted' = the draft order is gone from Shopify; the row is kept so a
-- staff-set outcome isn't lost.
ALTER TABLE bookings ADD COLUMN synced_at timestamptz NOT NULL DEFAULT now();

-- Where each incremental sync got to ('orders:india', 'bookings:india', …), and how
-- its last run went (shown on the tracking-health card).
CREATE TABLE sync_state (
  key          text PRIMARY KEY,
  cursor       timestamptz,                 -- Shopify updatedAt reached so far
  last_run_at  timestamptz,
  last_result  jsonb
);
