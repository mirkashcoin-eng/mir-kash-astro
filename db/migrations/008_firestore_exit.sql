-- The three Firestore collections that had no Neon home yet, so Firestore can be switched off:
--   admins              Team access (who besides the ADMIN_EMAILS founders may open /admin)
--   coupon_redemptions  India coupon usage ledger (the usage-limit counts at checkout)
--   customer_profiles   Saved delivery details of signed-in customers (was `profiles/{uid}`)

CREATE TABLE admins (
  email     text PRIMARY KEY,                  -- lowercased
  role      text NOT NULL CHECK (role IN ('full', 'affiliate')),
  label     text,
  added_by  text,
  added_at  timestamptz NOT NULL DEFAULT now()
);

-- One row per code per order. The primary key makes recording idempotent: the return
-- page, the Cashfree webhook and the reconciler all finalize the same order.
CREATE TABLE coupon_redemptions (
  code        text NOT NULL,                   -- uppercased
  order_name  text NOT NULL,
  order_id    text,
  email       text,                            -- lowercased
  phone       text,                            -- last 10 digits
  amount      numeric NOT NULL DEFAULT 0,
  at          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (code, order_name)
);
CREATE INDEX coupon_redemptions_email_idx ON coupon_redemptions (code, email) WHERE email IS NOT NULL;
CREATE INDEX coupon_redemptions_phone_idx ON coupon_redemptions (code, phone) WHERE phone IS NOT NULL;

-- Keyed by the Firebase Auth uid. Read and written only through /api/account/profile,
-- which checks the caller's ID token; never from the browser.
CREATE TABLE customer_profiles (
  uid         text PRIMARY KEY,
  email       text,
  full_name   text,
  phone       text,
  address1    text,
  address2    text,
  city        text,
  province    text,
  zip         text,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
