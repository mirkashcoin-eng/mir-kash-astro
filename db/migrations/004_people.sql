-- Mir Kash analytics — People.
--
-- v_people: one row per known person AND per anonymous visitor who did something
-- beyond a single page view. A person's history is every event of every browser
-- linked to them (visitors.person_id), so a buyer who browsed on her phone and paid
-- on her laptop is one row with both visits.
--
--   id        person_id for a known person; 'v:' || visitor_id for an anonymous browser
--   kind      'person' | 'visitor'
--
-- Anonymous visitors are included when they viewed 2+ pages or did anything other
-- than load a page (product view, cart, search, contact tap, booking step…). One
-- page load and gone is a bounce, not a lead, and would bury everyone else.
--
-- Bots and test numbers ARE in the view, flagged (is_bot, is_test); the /admin
-- endpoints filter them out by default.
--
-- Furthest stage, in order (each needs proof in our own data):
--   visited → viewed (product page) → cart (add to cart) → checkout (opened
--   checkout / OTP) → phone (gave a phone number) → address → payment (payment
--   step, or any order incl. cancelled) → ordered (a live, uncancelled order).
--
-- mv_people is the same rows, materialised, so the People list and the Action inbox
-- can search, filter and sort 100k+ people in milliseconds instead of re-reading
-- millions of events per page load. It is refreshed on demand (people_refresh(),
-- below) when it is older than a few minutes — /admin loads data on page load only,
-- so there is no polling. A rebuild re-reads the whole event log (about 6 s at 2M
-- events); if that ever makes the first page load of the day slow, call
-- `SELECT people_refresh()` from a cron and page loads will find it fresh. The
-- person detail endpoint reads the live tables, so one timeline is always current.

CREATE VIEW v_people AS
WITH
-- Every browser, keyed to the row it belongs to.
vk AS NOT MATERIALIZED (
  SELECT v.visitor_id, COALESCE(v.person_id, 'v:' || v.visitor_id) AS key,
         v.person_id, v.is_bot, v.is_test, v.first_seen, v.last_seen
  FROM visitors v
),
-- What each browser did, from the raw event log: one pass, grouped by the
-- browser (cheap key), then rolled up to the row below.
evv AS (
  SELECT e.visitor_id,
    min(e.ts) AS first_ts,
    max(e.ts) AS last_ts,
    count(DISTINCT e.session_id) AS visits,
    count(*) FILTER (WHERE e.name = 'page_view') AS page_views,
    -- anything beyond loading pages (passive tracker events don't count)
    bool_or(e.name NOT IN ('page_view', 'page_engaged', 'web_vital', 'js_error')) AS acted,
    array_agg(DISTINCT e.product) FILTER (WHERE e.product IS NOT NULL
      AND e.name IN ('product_view', 'sold_out_view', 'add_to_cart')) AS products,
    bool_or(e.name IN ('product_view', 'sold_out_view')) AS s_viewed,
    max(e.ts) FILTER (WHERE e.name = 'add_to_cart') AS last_cart_at,
    -- cart value = cart total on the LATEST add to cart
    (array_agg(e.props->>'cart_total' ORDER BY e.ts DESC) FILTER (WHERE e.name = 'add_to_cart'))[1] AS cart_total_raw,
    (array_agg(e.currency ORDER BY e.ts DESC) FILTER (WHERE e.name = 'add_to_cart'))[1] AS cart_currency,
    bool_or(e.name IN ('checkout_start', 'otp_sent', 'otp_verified', 'otp_failed', 'coupon_apply')) AS s_checkout,
    min(e.ts) FILTER (WHERE e.name IN ('phone', 'otp_verified')) AS phone_at,
    bool_or(e.name = 'address') AS s_address,
    bool_or(e.name IN ('payment_method', 'payment_start', 'payment_success', 'payment_failed')) AS s_payment,
    max(e.ts) FILTER (WHERE e.name IN ('booking_step', 'booking_submitted')) AS booking_at,
    (array_agg(e.props->>'bookingFlow' ORDER BY e.ts DESC)
      FILTER (WHERE e.name = 'booking_step' AND e.props ? 'bookingFlow'))[1] AS booking_flow
  FROM events e
  GROUP BY e.visitor_id
),
-- Engaged time: the tracker re-sends a page's running total, so take the largest
-- report per page view, then add the page views up. A page view belongs to one
-- browser, so page_view_id alone is the group.
engv AS (
  SELECT visitor_id, sum(ms)::bigint AS engaged_ms
  FROM (
    SELECT min(e.visitor_id) AS visitor_id,
           max(CASE WHEN e.props->>'ms' ~ '^[0-9]{1,9}(\.[0-9]+)?$' THEN (e.props->>'ms')::numeric END) AS ms
    FROM events e
    WHERE e.name = 'page_engaged' AND e.page_view_id IS NOT NULL
    GROUP BY e.page_view_id
  ) pv
  GROUP BY visitor_id
),
-- Browsers rolled up to their row (a person may have several).
ev AS (
  SELECT vk.key,
    min(x.first_ts) AS first_ts, max(x.last_ts) AS last_ts,
    sum(x.visits) AS visits, sum(x.page_views) AS page_views, bool_or(x.acted) AS acted,
    bool_or(x.s_viewed) AS s_viewed,
    max(x.last_cart_at) AS last_cart_at,
    (array_agg(x.cart_total_raw ORDER BY x.last_cart_at DESC NULLS LAST))[1] AS cart_total_raw,
    (array_agg(x.cart_currency ORDER BY x.last_cart_at DESC NULLS LAST))[1] AS cart_currency,
    bool_or(x.s_checkout) AS s_checkout, min(x.phone_at) AS phone_at,
    bool_or(x.s_address) AS s_address, bool_or(x.s_payment) AS s_payment,
    max(x.booking_at) AS booking_at,
    (array_agg(x.booking_flow ORDER BY x.booking_at DESC NULLS LAST))[1] AS booking_flow,
    sum(g.engaged_ms) AS engaged_ms
  FROM evv x
  JOIN vk ON vk.visitor_id = x.visitor_id
  LEFT JOIN engv g ON g.visitor_id = x.visitor_id
  GROUP BY vk.key
),
-- Distinct bags across all of a row's browsers.
prod AS (
  SELECT vk.key, array_agg(DISTINCT p ORDER BY p) AS products
  FROM evv x
  JOIN vk ON vk.visitor_id = x.visitor_id
  CROSS JOIN LATERAL unnest(x.products) p
  GROUP BY vk.key
),
vagg AS (
  SELECT key, min(person_id) AS person_id,
         bool_and(is_bot) AS is_bot,            -- a person is a bot only if every browser was
         bool_or(is_test) AS is_test,
         min(first_seen) AS first_seen, max(last_seen) AS last_seen
  FROM vk GROUP BY key
),
-- First and last visit of each row, for first-touch / last-touch attribution.
ss AS NOT MATERIALIZED (
  SELECT vk.key, s.started_at, s.source, s.medium, s.campaign, s.device, s.city, s.country
  FROM sessions s JOIN vk ON vk.visitor_id = s.visitor_id
),
first_s AS (SELECT DISTINCT ON (key) * FROM ss ORDER BY key, started_at ASC),
last_s  AS (SELECT DISTINCT ON (key) * FROM ss ORDER BY key, started_at DESC),
-- Shopify is authoritative for money. Cancelled orders don't count as orders or
-- value, but do prove the person reached payment.
ord AS (
  SELECT person_id,
    count(*) FILTER (WHERE cancelled_at IS NULL) AS orders,
    count(*) AS orders_any,
    COALESCE(sum(COALESCE(total_inr, CASE WHEN currency = 'INR' THEN total END))
      FILTER (WHERE cancelled_at IS NULL), 0)::numeric(12,2) AS ltv,
    min(created_at) FILTER (WHERE cancelled_at IS NULL) AS first_order_at,
    max(created_at) FILTER (WHERE cancelled_at IS NULL) AS last_order_at,
    max(created_at) AS last_any_order_at
  FROM orders WHERE person_id IS NOT NULL GROUP BY person_id
),
bk AS (
  SELECT person_id, count(*) AS bookings, max(created_at) AS last_booking_at,
         (array_agg(flow ORDER BY created_at DESC))[1] AS flow
  FROM bookings WHERE person_id IS NOT NULL GROUP BY person_id
),
-- One row per key: every browser-derived key, plus people with no browser yet.
rows AS (
  SELECT COALESCE(va.key, p.person_id) AS id,
         COALESCE(p.person_id, va.person_id) AS person_id,
         va.key AS vkey, va.is_bot, va.is_test AS v_test, va.first_seen AS v_first, va.last_seen AS v_last,
         p.phone, p.email, p.name, p.address1, p.city AS p_city,
         p.first_seen AS p_first, p.last_seen AS p_last, p.is_test AS p_test
  FROM vagg va
  FULL JOIN people p ON p.person_id = va.key
)
SELECT
  r.id,
  CASE WHEN r.person_id IS NOT NULL THEN 'person' ELSE 'visitor' END AS kind,
  r.person_id, r.name, r.phone, r.email,
  -- people.first_seen defaults to the insert time, so the event log wins when older
  LEAST(ev.first_ts, r.v_first, r.p_first, o.first_order_at) AS first_seen,
  COALESCE(GREATEST(ev.last_ts, r.v_last, o.last_any_order_at, b.last_booking_at), r.p_last) AS last_seen,
  COALESCE(ev.visits, 0)::int AS visits,
  COALESCE(ev.visits, 0) > 1 AS is_returning,
  fs.source AS first_source, fs.medium AS first_medium, fs.campaign AS first_campaign,
  ls.source AS last_source,  ls.medium AS last_medium,  ls.campaign AS last_campaign,
  ls.device,
  COALESCE(NULLIF(r.p_city, ''), ls.city) AS city,   -- the city they typed beats IP geo
  ls.country,
  COALESCE(pr.products, '{}') AS products,
  COALESCE(cardinality(pr.products), 0)::int AS products_viewed,
  COALESCE(ev.engaged_ms, 0)::bigint AS engaged_ms,
  CASE
    WHEN COALESCE(o.orders, 0) > 0 THEN 'ordered'
    WHEN ev.s_payment OR COALESCE(o.orders_any, 0) > 0 THEN 'payment'
    WHEN ev.s_address OR r.address1 IS NOT NULL THEN 'address'
    WHEN ev.phone_at IS NOT NULL OR r.phone IS NOT NULL THEN 'phone'
    WHEN ev.s_checkout THEN 'checkout'
    WHEN ev.last_cart_at IS NOT NULL THEN 'cart'
    WHEN ev.s_viewed THEN 'viewed'
    ELSE 'visited'
  END AS stage,
  CASE WHEN ev.cart_total_raw ~ '^[0-9]{1,9}(\.[0-9]+)?$' THEN ev.cart_total_raw::numeric(12,2) END AS cart_value,
  COALESCE(ev.cart_currency, 'INR') AS cart_currency,
  ev.last_cart_at,
  COALESCE(ev.s_checkout OR ev.s_payment, false) AS checkout_reached,
  r.phone IS NOT NULL AS phone_given,
  COALESCE(ev.phone_at, CASE WHEN r.phone IS NOT NULL THEN r.p_first END) AS phone_at,
  (b.bookings > 0 OR ev.booking_at IS NOT NULL) IS TRUE AS booking_started,
  COALESCE(b.flow, ev.booking_flow) AS booking_flow,
  COALESCE(b.bookings, 0)::int AS bookings,
  COALESCE(o.orders, 0)::int AS orders,
  COALESCE(o.ltv, 0)::numeric(12,2) AS ltv,
  o.first_order_at, o.last_order_at,
  CASE WHEN o.first_order_at IS NOT NULL
        AND o.first_order_at >= LEAST(ev.first_ts, r.v_first, r.p_first)
       THEN floor(extract(epoch FROM o.first_order_at - LEAST(ev.first_ts, r.v_first, r.p_first)) / 86400)::int
  END AS days_to_first_purchase,
  COALESCE(r.is_bot, false) AND r.person_id IS NULL AS is_bot,   -- someone who gave a number is human
  COALESCE(r.v_test, false) OR COALESCE(r.p_test, false)
    OR EXISTS (SELECT 1 FROM test_people t WHERE t.person_id = r.person_id) AS is_test,
  -- one lower-cased haystack for the search box: name, phone, email, bags, sources
  lower(concat_ws(' ', r.name, r.phone, r.email, array_to_string(pr.products, ' '),
    fs.source, fs.campaign, ls.source, ls.campaign)) AS search
FROM rows r
LEFT JOIN ev  ON ev.key = r.vkey
LEFT JOIN prod pr ON pr.key = r.vkey
LEFT JOIN first_s fs ON fs.key = r.vkey
LEFT JOIN last_s  ls ON ls.key = r.vkey
LEFT JOIN ord o ON o.person_id = r.person_id
LEFT JOIN bk  b ON b.person_id = r.person_id
WHERE r.person_id IS NOT NULL
   OR ev.page_views > 1
   OR ev.acted;

-- ── Materialised copy for the list + inbox ──────────────────────────────────

CREATE EXTENSION IF NOT EXISTS pg_trgm;   -- substring search on name/phone/email/bag/source

CREATE MATERIALIZED VIEW mv_people AS SELECT * FROM v_people;

CREATE UNIQUE INDEX mv_people_id_idx ON mv_people (id);           -- needed to refresh CONCURRENTLY
CREATE INDEX mv_people_last_seen_idx ON mv_people (last_seen DESC NULLS LAST, id) WHERE NOT is_bot AND NOT is_test;
CREATE INDEX mv_people_first_seen_idx ON mv_people (first_seen);
CREATE INDEX mv_people_ltv_idx ON mv_people (ltv DESC) WHERE ltv > 0;
CREATE INDEX mv_people_search_idx ON mv_people USING gin (search gin_trgm_ops);

-- When mv_people was last rebuilt (one row).
CREATE TABLE people_refreshed (
  id  boolean PRIMARY KEY DEFAULT true CHECK (id),
  at  timestamptz NOT NULL
);
INSERT INTO people_refreshed (at) VALUES (now());

-- Rebuild mv_people if it is older than max_age; returns the time it was built.
-- Every /admin People and Inbox request calls this first, so the list is never
-- more than max_age behind without anything polling. Concurrent callers queue on
-- one lock and the second finds it fresh. CONCURRENTLY: readers are never blocked.
CREATE FUNCTION people_refresh(max_age interval DEFAULT interval '5 minutes')
RETURNS timestamptz
LANGUAGE plpgsql
SET work_mem = '128MB'                      -- the rebuild sorts the event log; keep most of it in memory
AS $$
DECLARE t timestamptz;
BEGIN
  SELECT at INTO t FROM people_refreshed;
  IF t IS NOT NULL AND clock_timestamp() - t < max_age THEN RETURN t; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('mv_people'));
  SELECT at INTO t FROM people_refreshed;   -- someone else may have just done it
  IF t IS NOT NULL AND clock_timestamp() - t < max_age THEN RETURN t; END IF;
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_people;
  t := clock_timestamp();
  UPDATE people_refreshed SET at = t;
  RETURN t;
END $$;

-- The person detail endpoint reads one person's bookings live.
CREATE INDEX IF NOT EXISTS bookings_person_idx ON bookings (person_id) WHERE person_id IS NOT NULL;
