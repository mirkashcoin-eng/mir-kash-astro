-- Mir Kash analytics — core schema.
--
-- One raw, append-only record of what happened (`events`), plus the few entities
-- events hang off (visitors, sessions, people) and the facts owned by other systems
-- (Shopify orders, Meta/Google ad spend, GA4 demographics). Every number /admin
-- shows is computed from these; nothing here is a pre-summed counter, so any number
-- can be recomputed and two sections can never disagree.
--
-- Times are timestamptz (UTC). "Days" are IST: bucket with (ts AT TIME ZONE 'Asia/Kolkata')::date.

-- ── Identity ────────────────────────────────────────────────────────────────

-- A known human. person_id = last 10 phone digits (same as personKey() in
-- src/lib/leads.ts), or 'e:' || lower(email) when we only have an email.
-- PII lives here and only here; events reference ids.
CREATE TABLE people (
  person_id   text PRIMARY KEY,
  phone       text,
  email       text,
  name        text,
  address1    text,
  city        text,
  province    text,
  pin         text,
  first_seen  timestamptz NOT NULL DEFAULT now(),
  last_seen   timestamptz NOT NULL DEFAULT now(),
  is_test     boolean NOT NULL DEFAULT false   -- internal/test number: excluded by default
);

-- One browser/device (localStorage `mk_vid`, kept ~2 years). Linked to a person once
-- they give a phone/email; every past event of the visitor then belongs to them —
-- nothing is copied or deleted.
CREATE TABLE visitors (
  visitor_id  text PRIMARY KEY,
  person_id   text REFERENCES people(person_id) ON UPDATE CASCADE,
  first_seen  timestamptz NOT NULL DEFAULT now(),
  last_seen   timestamptz NOT NULL DEFAULT now(),
  is_bot      boolean NOT NULL DEFAULT false,
  bot_name    text,
  is_test     boolean NOT NULL DEFAULT false
);
CREATE INDEX visitors_person_idx ON visitors (person_id) WHERE person_id IS NOT NULL;
CREATE INDEX visitors_first_seen_idx ON visitors (first_seen);

-- One visit: a run of activity with no gap over 30 minutes (client decides; `mk_sess`).
-- First-touch attribution of THIS visit is written once, on insert.
CREATE TABLE sessions (
  session_id  text PRIMARY KEY,
  visitor_id  text NOT NULL REFERENCES visitors(visitor_id),
  started_at  timestamptz NOT NULL,
  last_at     timestamptz NOT NULL,
  landing     text,
  referrer    text,
  source      text,      -- utm_source, else derived from referrer/click id ('google', 'instagram', 'direct', …)
  medium      text,      -- utm_medium, else derived ('organic', 'social', 'referral', 'cpc', 'none')
  campaign    text,
  content     text,      -- utm_content: which ad / creative
  term        text,      -- utm_term: keyword
  fbclid      text,
  gclid       text,
  affiliate   text,      -- /go/{affiliate} code, when the visit came through one
  device      text,      -- 'mobile' | 'tablet' | 'desktop'
  os          text,
  browser     text,
  screen      text,      -- '390x844'
  country     text,
  city        text,
  market      text,
  is_bot      boolean NOT NULL DEFAULT false
);
CREATE INDEX sessions_visitor_idx ON sessions (visitor_id, started_at);
CREATE INDEX sessions_started_idx ON sessions (started_at);

-- ── The raw record ──────────────────────────────────────────────────────────

-- Every action. Append-only; event_id is a client UUID so a retried/duplicated
-- beacon is ignored (ON CONFLICT DO NOTHING) instead of double-counted.
-- Test status is NOT stored here — it's read through visitors/people, so marking a
-- number as test later corrects all of that person's history at once.
CREATE TABLE events (
  event_id    uuid PRIMARY KEY,
  ts          timestamptz NOT NULL DEFAULT now(),  -- server receive time (authoritative)
  client_ts   timestamptz,                          -- browser clock, for ordering within a page
  visitor_id  text NOT NULL,
  session_id  text NOT NULL,
  name        text NOT NULL,                        -- see src/lib/events.ts
  page        text,                                 -- path, no query string
  page_view_id uuid,                                -- groups events of one page load
  product     text,                                 -- Shopify product handle
  value       numeric(12,2),
  currency    text,
  props       jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_bot      boolean NOT NULL DEFAULT false,
  migrated    boolean NOT NULL DEFAULT false        -- synthesized from Firestore history
);
CREATE INDEX events_ts_idx ON events (ts);
CREATE INDEX events_visitor_idx ON events (visitor_id, ts);
CREATE INDEX events_session_idx ON events (session_id, ts);
CREATE INDEX events_name_idx ON events (name, ts);
CREATE INDEX events_product_idx ON events (product, ts) WHERE product IS NOT NULL;
CREATE INDEX events_pv_idx ON events (page_view_id) WHERE page_view_id IS NOT NULL;

-- Tracking health: what /api/collect refused and why (bad payload, unknown event…).
CREATE TABLE collect_rejects (
  day     date NOT NULL,
  reason  text NOT NULL,
  n       integer NOT NULL DEFAULT 0,
  PRIMARY KEY (day, reason)
);

-- Phone keys whose activity is internal/testing. Replaces HIDDEN_PERSON_KEYS.
CREATE TABLE test_people (
  person_id  text PRIMARY KEY,
  note       text
);
INSERT INTO test_people (person_id, note) VALUES
  ('7738784781', 'founder test number'),
  ('8306883773', 'founder test number');

-- ── Facts owned by other systems ────────────────────────────────────────────

-- Shopify orders (India + Global stores). Shopify is authoritative for money;
-- this is a mirror kept by webhook + backfill + nightly reconcile.
CREATE TABLE orders (
  order_id       text PRIMARY KEY,                  -- Shopify GID
  store          text NOT NULL,                     -- 'india' | 'global'
  name           text,                              -- '#1042'
  created_at     timestamptz NOT NULL,
  cancelled_at   timestamptz,
  person_id      text,
  phone          text,
  email          text,
  currency       text NOT NULL,
  total          numeric(12,2) NOT NULL,
  total_inr      numeric(12,2),                     -- converted at order time
  discount_codes text[] NOT NULL DEFAULT '{}',
  payment_method text,
  billing_name   text,
  shipping_name  text,
  shipping_city  text,
  shipping_country text,
  likely_gift    boolean,                           -- inferred: shipping name/city differ from buyer
  items          jsonb NOT NULL DEFAULT '[]'::jsonb, -- [{handle, title, variant, quantity, price}]
  financial_status   text,
  fulfillment_status text,
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX orders_created_idx ON orders (created_at);
CREATE INDEX orders_person_idx ON orders (person_id);

-- Returns (from /api/returns + Shopify), with the customer's reason.
CREATE TABLE returns (
  return_id   text PRIMARY KEY,
  order_id    text,
  person_id   text,
  created_at  timestamptz NOT NULL,
  reason      text,
  items       jsonb NOT NULL DEFAULT '[]'::jsonb
);

-- Try at Home / Private Viewing bookings and what came of them.
CREATE TABLE bookings (
  booking_id  text PRIMARY KEY,                     -- Shopify draft order GID
  flow        text NOT NULL,                        -- 'try_at_home' | 'private_viewing'
  person_id   text,
  created_at  timestamptz NOT NULL,
  date        date,
  slot        text,
  city        text,
  bags        text[] NOT NULL DEFAULT '{}',
  status      text,                                 -- Shopify-side status
  outcome     text,                                 -- 'completed' | 'no_show' | 'cancelled' (staff, in /admin)
  outcome_at  timestamptz
);
CREATE INDEX bookings_created_idx ON bookings (created_at);

-- WhatsApp messages we sent (recovery etc.) and what happened.
CREATE TABLE wa_messages (
  message_id  text PRIMARY KEY,                     -- Meta wamid
  person_id   text,
  template    text NOT NULL,
  ref         text,                                 -- draft/order it was about
  sent_at     timestamptz NOT NULL,
  delivered_at timestamptz,
  read_at     timestamptz,
  replied_at  timestamptz,
  failed      text
);

-- Daily ad spend per campaign/ad (Meta, Google), for cost per sale and ROAS.
CREATE TABLE ad_spend (
  day          date NOT NULL,
  platform     text NOT NULL,                       -- 'meta' | 'google'
  campaign_id  text NOT NULL,
  campaign     text,
  ad_id        text NOT NULL DEFAULT '',
  ad           text,
  spend        numeric(12,2) NOT NULL,
  currency     text NOT NULL,
  impressions  integer,
  clicks       integer,
  PRIMARY KEY (day, platform, campaign_id, ad_id)
);

-- GA4 audience aggregates (age, gender, interests, device…), synced nightly.
-- GA withholds small groups (thresholding), so missing rows mean "not enough data".
CREATE TABLE ga_audience_daily (
  day        date NOT NULL,
  dimension  text NOT NULL,                         -- 'age' | 'gender' | 'interest' | 'device' | 'city' | …
  value      text NOT NULL,
  users      integer NOT NULL DEFAULT 0,
  sessions   integer NOT NULL DEFAULT 0,
  conversions integer NOT NULL DEFAULT 0,
  PRIMARY KEY (day, dimension, value)
);

-- Old Firestore daily counters (funnel_daily, analytics_daily, product_stats), kept
-- for days before the event log existed. Read-only history.
CREATE TABLE legacy_daily (
  day     date NOT NULL,
  source  text NOT NULL,                            -- 'funnel_daily' | 'analytics_daily' | 'product_stats'
  metric  text NOT NULL,
  value   numeric NOT NULL,
  PRIMARY KEY (day, source, metric)
);

-- ── Acting on it ────────────────────────────────────────────────────────────

-- Action inbox items the team handled, and the outcome (feeds the lead score).
CREATE TABLE inbox_actions (
  id          bigserial PRIMARY KEY,
  kind        text NOT NULL,                        -- 'hot_lead' | 'payment_failed' | 'booking_confirm' | 'restock'
  ref         text NOT NULL,                        -- person_id / order / booking id
  done_at     timestamptz NOT NULL DEFAULT now(),
  done_by     text,                                 -- admin email
  outcome     text,                                 -- 'contacted' | 'no_answer' | 'ordered' | 'not_interested' | …
  note        text
);
CREATE INDEX inbox_actions_ref_idx ON inbox_actions (kind, ref);

-- Founder-set goals per metric; cards show progress against them.
CREATE TABLE targets (
  metric      text PRIMARY KEY,
  value       numeric NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
