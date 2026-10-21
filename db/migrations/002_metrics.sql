-- Mir Kash analytics — the metrics layer (read side).
--
-- Every number /admin shows is defined once, here, as a view over the raw tables in
-- 001_core.sql; src/lib/metrics only filters and aggregates these views. Shared rules:
--
--  • Days are IST: (ts AT TIME ZONE 'Asia/Kolkata')::date. A visit belongs to the day
--    it started; an order to the day it was placed.
--  • `who` = one human: the person (phone/email) when the browser has been linked to
--    one, else the browser — COALESCE(visitors.person_id, visitors.visitor_id). It is
--    stitched at query time, so linking a phone later re-attributes that person's
--    whole history (past days' numbers can move slightly when that happens).
--  • is_bot / is_test are columns, never filtered here; src/lib/metrics excludes both
--    by default. Bot = the browser was ever seen with a crawler user-agent
--    (visitors.is_bot, which /api/collect ORs across every request, so it covers the
--    event and session flags too). Test = the browser or its person is internal
--    (visitors.is_test, people.is_test or test_people).
--  • Only real events and visits count (events.migrated = false; imported sessions are
--    left out of v_sessions). Days before the event log existed come from
--    legacy_daily, in the daily rollups only, flagged `legacy`.
--  • Row-level views (v_events, v_page_views, v_sessions, v_orders, v_order_touch,
--    v_acquisition, v_products, v_checkout_steps) keep their timestamp so callers
--    filter by time range FIRST (`ts >= $from AND ts < $to`) and the existing ts
--    indexes do the work; per-row extras (engaged time, attribution) are index
--    lookups bounded by that range. Distinct counts and medians over a range are
--    computed from these rows, never by summing days.
--  • Rollups (v_traffic_daily, v_funnel_daily, v_tracking_health) carry `day`; a
--    `day BETWEEN` filter is pushed down to the IST-day expression indexes below.
--    v_cohorts_weekly covers all history (it is built from sessions, not events).

-- ── Helpers ─────────────────────────────────────────────────────────────────

-- jsonb text → integer, or NULL for anything that isn't a plain non-negative number.
-- props come from the browser: a bad value must read as "unknown", never as an error.
CREATE FUNCTION mk_int(t text) RETURNS integer
LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$ SELECT CASE WHEN t ~ '^[0-9]{1,9}(\.[0-9]+)?$' THEN round(t::numeric)::integer END $$;

CREATE FUNCTION mk_num(t text) RETURNS numeric
LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$ SELECT CASE WHEN t ~ '^-?[0-9]{1,12}(\.[0-9]+)?$' THEN t::numeric END $$;

-- v capped at `cap`, NULL kept as NULL (LEAST would turn a missing value into the cap).
CREATE FUNCTION mk_cap(v integer, cap integer) RETURNS integer
LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$ SELECT CASE WHEN v > cap THEN cap ELSE v END $$;

-- Product handle of a product page path: /products/{handle} or /{locale}/products/{handle}.
CREATE FUNCTION mk_handle(page text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$ SELECT lower(substring(page FROM '/products/([^/?#]+)')) $$;

-- Midnight IST at the start of an IST date, as a timestamptz.
CREATE FUNCTION mk_ist_start(d date) RETURNS timestamptz
LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$ SELECT d::timestamp AT TIME ZONE 'Asia/Kolkata' $$;

-- ── Indexes the rollups need ────────────────────────────────────────────────

-- IST day (+ name) for the daily rollups. INCLUDE lets tracking health count a day's
-- events from the index alone, and lets v_legacy_daily ask "did this day have any
-- real event?" without touching the table. (Plain CREATE INDEX: it briefly blocks
-- event inserts while it builds — instant while the table is small.)
CREATE INDEX events_ist_day_idx ON events (((ts AT TIME ZONE 'Asia/Kolkata')::date), name)
  INCLUDE (is_bot, migrated);
CREATE INDEX sessions_ist_day_idx ON sessions (((started_at AT TIME ZONE 'Asia/Kolkata')::date));

-- ── Identity ────────────────────────────────────────────────────────────────

-- One row per browser, with the human it belongs to and that human's flags.
--   who_first_seen = when this human was first seen on ANY of their browsers (or, for
--   history imported as a person, people.first_seen if earlier). "New visitor" and
--   weekly cohorts are based on it.
CREATE VIEW v_visitors AS
SELECT v.visitor_id,
       v.person_id,
       COALESCE(v.person_id, v.visitor_id) AS who,
       v.first_seen,
       CASE WHEN v.person_id IS NULL THEN v.first_seen
            ELSE LEAST(p.first_seen, (SELECT min(v2.first_seen) FROM visitors v2 WHERE v2.person_id = v.person_id))
       END AS who_first_seen,
       v.is_bot,
       (v.is_test OR COALESCE(p.is_test, false) OR tp.person_id IS NOT NULL) AS is_test
FROM visitors v
LEFT JOIN people p ON p.person_id = v.person_id
LEFT JOIN test_people tp ON tp.person_id = v.person_id;

-- ── Events ──────────────────────────────────────────────────────────────────

-- Every real event, with its IST day, its human and their flags.
--   product = the event's own product handle, else the product page it happened on
--   (add_to_cart from a product page carries only the page). NULL elsewhere — e.g. a
--   quick-add from a collection grid can't be tied to a product.
CREATE VIEW v_events AS
SELECT e.event_id,
       e.ts,
       (e.ts AT TIME ZONE 'Asia/Kolkata')::date AS day,
       e.visitor_id,
       e.session_id,
       vv.person_id,
       vv.who,
       e.name,
       e.page,
       e.page_view_id,
       COALESCE(lower(e.product), mk_handle(e.page)) AS product,
       e.value,
       e.currency,
       e.props,
       (e.is_bot OR vv.is_bot) AS is_bot,
       vv.is_test
FROM events e
JOIN v_visitors vv ON vv.visitor_id = e.visitor_id
WHERE NOT e.migrated;

-- One row per page view (a `page_view` event), with what happened on that page.
--   engaged_ms  = MAX(props.ms) over the page view's `page_engaged` reports (the
--                 tracker re-sends the running total, so repeats are harmless),
--                 capped at 2 h so a forged value can't distort sums. NULL = no
--                 report arrived (excluded from medians, not counted as 0).
--   max_scroll  = deepest scroll reached, 0–100 %.
--   gallery_depth = distinct gallery images shown or zoomed (props.index).
--   product     = handle when the page is a product page (/products/{handle}),
--                 else NULL. A product page fires product_view once per page view,
--                 so "product page views" here and product_view events agree.
--   added_to_cart = add_to_cart fired on this page view.
-- Duplicate beacons can't double count: events.event_id is unique. The per-page
-- stats are one index lookup per page view (events_pv_idx), only for the rows a
-- query keeps and only when it reads those columns.
CREATE VIEW v_page_views AS
SELECT pv.event_id,
       pv.page_view_id,
       pv.ts,
       pv.day,
       pv.visitor_id,
       pv.session_id,
       pv.who,
       pv.page,
       mk_handle(pv.page) AS product,
       mk_cap(x.engaged_ms, 7200000) AS engaged_ms,
       mk_cap(x.max_scroll, 100) AS max_scroll,
       COALESCE(x.gallery_depth, 0) AS gallery_depth,
       COALESCE(x.zoomed, false) AS zoomed,
       COALESCE(x.sold_out, false) AS sold_out,
       COALESCE(x.added_to_cart, false) AS added_to_cart,
       pv.is_bot,
       pv.is_test
FROM v_events pv
LEFT JOIN LATERAL (
  SELECT max(mk_int(e.props->>'ms')) FILTER (WHERE e.name = 'page_engaged') AS engaged_ms,
         max(mk_int(e.props->>'scroll')) FILTER (WHERE e.name = 'page_engaged') AS max_scroll,
         count(DISTINCT e.props->>'index') FILTER (WHERE e.name IN ('gallery_view', 'gallery_zoom')) AS gallery_depth,
         bool_or(e.name = 'gallery_zoom') AS zoomed,
         bool_or(e.name = 'sold_out_view') AS sold_out,
         bool_or(e.name = 'add_to_cart') AS added_to_cart
  FROM events e
  WHERE e.page_view_id = pv.page_view_id AND NOT e.migrated
) x ON true
WHERE pv.name = 'page_view';

-- ── Orders ──────────────────────────────────────────────────────────────────

-- Live orders (not cancelled), in INR.
--   revenue_inr = total_inr (converted at order time), else total when already INR.
--   nth         = this person's 1st, 2nd, … live order (1 = first purchase). Orders
--                 with no person are each their own "person".
--   is_test     = the buyer is a test person.
CREATE VIEW v_orders AS
SELECT o.order_id,
       o.store,
       o.name,
       o.created_at,
       (o.created_at AT TIME ZONE 'Asia/Kolkata')::date AS day,
       o.person_id,
       o.currency,
       o.total,
       COALESCE(o.total_inr, CASE WHEN o.currency = 'INR' THEN o.total END) AS revenue_inr,
       o.discount_codes,
       o.payment_method,
       o.likely_gift,
       o.shipping_city,
       o.shipping_country,
       o.items,
       row_number() OVER (PARTITION BY COALESCE(o.person_id, o.order_id) ORDER BY o.created_at, o.order_id) AS nth,
       (COALESCE(p.is_test, false) OR tp.person_id IS NOT NULL) AS is_test
FROM orders o
LEFT JOIN people p ON p.person_id = o.person_id
LEFT JOIN test_people tp ON tp.person_id = o.person_id
WHERE o.cancelled_at IS NULL;

-- One row per order line. revenue_inr = quantity × line price, converted at the
-- order's own rate (revenue_inr / total) — list value before order-level discounts
-- and shipping, so product revenue won't add up exactly to order revenue.
CREATE VIEW v_order_items AS
SELECT o.order_id,
       o.created_at,
       o.day,
       o.person_id,
       lower(i->>'handle') AS product,
       i->>'title' AS title,
       COALESCE(mk_int(i->>'quantity'), 1) AS units,
       COALESCE(mk_int(i->>'quantity'), 1) * mk_num(i->>'price')
         * CASE WHEN o.currency = 'INR' THEN 1 ELSE o.revenue_inr / NULLIF(o.total, 0) END AS revenue_inr,
       o.is_test
FROM v_orders o
CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(o.items) = 'array' THEN o.items ELSE '[]'::jsonb END) i;

-- Which visit gets the credit for an order. The order's person → every browser
-- linked to them (visitors.person_id) → their non-bot sessions that STARTED at or
-- before the order was placed:
--   last touch  = the latest of those sessions   (default for "which channel sells")
--   first touch = the earliest of those sessions  (what first brought them in)
--   sessions_to_order = how many of those sessions there were.
-- No lookback window. Orders with no person, or no linked browser, have NULL touch
-- columns and show as "(unattributed)".
CREATE VIEW v_order_touch AS
SELECT o.order_id,
       o.created_at,
       o.day,
       o.person_id,
       o.revenue_inr,
       o.nth,
       o.is_test,
       t.sessions_to_order,
       lt.session_id AS last_session_id,
       lt.started_at AS last_touch_at,
       lt.source     AS last_source,
       lt.medium     AS last_medium,
       lt.campaign   AS last_campaign,
       lt.content    AS last_content,
       ft.session_id AS first_session_id,
       ft.started_at AS first_touch_at,
       ft.source     AS first_source,
       ft.medium     AS first_medium,
       ft.campaign   AS first_campaign,
       ft.content    AS first_content
FROM v_orders o
LEFT JOIN LATERAL (
  SELECT count(*) AS sessions_to_order,
         (array_agg(s.session_id ORDER BY s.started_at, s.session_id))[1] AS first_id,
         (array_agg(s.session_id ORDER BY s.started_at DESC, s.session_id DESC))[1] AS last_id
  FROM visitors v
  JOIN sessions s ON s.visitor_id = v.visitor_id
  WHERE v.person_id = o.person_id AND NOT v.is_bot AND NOT s.is_bot AND s.started_at <= o.created_at
) t ON true
LEFT JOIN sessions lt ON lt.session_id = t.last_id
LEFT JOIN sessions ft ON ft.session_id = t.first_id;

-- ── Sessions ────────────────────────────────────────────────────────────────

-- One row per REAL visit (session), with its source, device and what happened in it.
-- Imported history is left out: scripts/migrate-firestore.mjs writes one synthetic
-- session per old browser spanning all its history, with session_id = visitor_id
-- (the old mk_sid); the live tracker's session and visitor ids are independent UUIDs,
-- so they never match. (Imported sessions still count as an order's first touch in
-- v_order_touch — they carry the old first-touch source.)
--   first_visit  = this is the human's first-ever visit (started at who_first_seen).
--   pages        = page views in the visit.
--   engaged_ms   = sum of the visit's page views' engaged time (each capped at 2 h);
--                  NULL when no page reported.
--   engaged      = engaged_ms ≥ 10 s or 2+ pages (GA's "engaged session").
--   products_viewed = distinct products whose page fired product_view.
--   added_to_cart / checkout_started / lead (phone given or booking submitted) /
--   paid (payment_success) = that event happened in the visit.
--   orders, revenue_inr = live orders whose LAST touch is this visit (v_order_touch).
-- The per-visit stats are an index lookup per session (events_session_idx), and
-- Postgres skips them entirely when a query doesn't read those columns.
CREATE VIEW v_sessions AS
SELECT s.session_id,
       s.visitor_id,
       vv.person_id,
       vv.who,
       vv.who_first_seen,
       s.started_at,
       s.last_at,
       (s.started_at AT TIME ZONE 'Asia/Kolkata')::date AS day,
       (s.started_at <= vv.who_first_seen + interval '1 second') AS first_visit,
       s.landing, s.referrer, s.source, s.medium, s.campaign, s.content, s.term,
       s.affiliate, s.device, s.os, s.browser, s.screen, s.country, s.city, s.market,
       COALESCE(a.pages, 0) AS pages,
       a.engaged_ms,
       (COALESCE(a.engaged_ms, 0) >= 10000 OR COALESCE(a.pages, 0) >= 2) AS engaged,
       COALESCE(a.products_viewed, 0) AS products_viewed,
       COALESCE(a.added_to_cart, false) AS added_to_cart,
       COALESCE(a.checkout_started, false) AS checkout_started,
       COALESCE(a.lead, false) AS lead,
       COALESCE(a.paid, false) AS paid,
       COALESCE(ot.orders, 0) AS orders,
       COALESCE(ot.revenue_inr, 0) AS revenue_inr,
       (s.is_bot OR vv.is_bot) AS is_bot,
       vv.is_test
FROM sessions s
JOIN v_visitors vv ON vv.visitor_id = s.visitor_id
LEFT JOIN LATERAL (
  SELECT count(*) FILTER (WHERE p.is_page) AS pages,
         sum(p.ms) AS engaged_ms,
         count(DISTINCT p.product) AS products_viewed,
         bool_or(p.cart) AS added_to_cart,
         bool_or(p.checkout) AS checkout_started,
         bool_or(p.lead) AS lead,
         bool_or(p.paid) AS paid
  FROM (
    SELECT bool_or(e.name = 'page_view') AS is_page,
           mk_cap(max(mk_int(e.props->>'ms')) FILTER (WHERE e.name = 'page_engaged'), 7200000) AS ms,
           max(COALESCE(lower(e.product), mk_handle(e.page))) FILTER (WHERE e.name = 'product_view') AS product,
           bool_or(e.name = 'add_to_cart') AS cart,
           bool_or(e.name = 'checkout_start') AS checkout,
           bool_or(e.name IN ('phone', 'booking_submitted')) AS lead,
           bool_or(e.name = 'payment_success') AS paid
    FROM events e
    WHERE e.session_id = s.session_id AND NOT e.migrated
    GROUP BY e.page_view_id
  ) p
) a ON true
LEFT JOIN (
  SELECT last_session_id, count(*) AS orders, sum(revenue_inr) AS revenue_inr
  FROM v_order_touch WHERE last_session_id IS NOT NULL
  GROUP BY last_session_id
) ot ON ot.last_session_id = s.session_id
WHERE s.session_id <> s.visitor_id;

-- ── Acquisition ─────────────────────────────────────────────────────────────

-- Everything a channel/campaign/ad gets credit for, one row per fact:
--   kind 'session'     a visit, credited to its own source (sessions, visitors)
--   kind 'lead'        a phone given / booking submitted, credited to the visit it happened in
--   kind 'order'       a live order, credited to its LAST touch (v_order_touch)
--   kind 'order_first' the same order, credited to its FIRST touch
--   kind 'spend'       a day of ad spend (INR only; other currencies are left out)
-- Touch columns are lower-cased so 'Diwali' and 'diwali' are one campaign. A
-- utm_campaign / utm_content that is a Meta/Google campaign or ad ID is replaced by
-- that campaign's / ad's name from ad_spend, so spend lines up with visits when the
-- ad URL uses either. Spend rows have no source/medium: cost per sale and ROAS exist
-- at campaign and ad level only. Missing values read '(none)'; orders with no visit
-- read source '(unattributed)'.
CREATE VIEW v_acquisition AS
WITH camp AS (
  SELECT DISTINCT ON (campaign_id) campaign_id, lower(campaign) AS campaign
  FROM ad_spend WHERE campaign IS NOT NULL
  ORDER BY campaign_id, day DESC
), ad AS (
  SELECT DISTINCT ON (ad_id) ad_id, lower(ad) AS ad
  FROM ad_spend WHERE ad IS NOT NULL AND ad_id <> ''
  ORDER BY ad_id, day DESC
)
SELECT 'session'::text AS kind, s.started_at AS ts, s.day, s.who, s.session_id,
       COALESCE(lower(s.source), '(none)') AS source,
       COALESCE(lower(s.medium), '(none)') AS medium,
       COALESCE(c.campaign, lower(s.campaign), '(none)') AS campaign,
       COALESCE(a.ad, lower(s.content), '(none)') AS content,
       0::numeric AS revenue_inr, 0::numeric AS spend_inr,
       s.is_bot, s.is_test
FROM v_sessions s
LEFT JOIN camp c ON c.campaign_id = s.campaign
LEFT JOIN ad a ON a.ad_id = s.content
UNION ALL
SELECT 'lead', e.ts, e.day, e.who, e.session_id,
       COALESCE(lower(s.source), '(none)'),
       COALESCE(lower(s.medium), '(none)'),
       COALESCE(c.campaign, lower(s.campaign), '(none)'),
       COALESCE(a.ad, lower(s.content), '(none)'),
       0, 0, e.is_bot, e.is_test
FROM v_events e
JOIN sessions s ON s.session_id = e.session_id
LEFT JOIN camp c ON c.campaign_id = s.campaign
LEFT JOIN ad a ON a.ad_id = s.content
WHERE e.name IN ('phone', 'booking_submitted')
UNION ALL
SELECT k.kind, o.created_at, o.day, o.person_id, k.session_id,
       COALESCE(lower(k.source), CASE WHEN k.session_id IS NULL THEN '(unattributed)' ELSE '(none)' END),
       COALESCE(lower(k.medium), '(none)'),
       COALESCE(c.campaign, lower(k.campaign), '(none)'),
       COALESCE(a.ad, lower(k.content), '(none)'),
       COALESCE(o.revenue_inr, 0), 0, false, o.is_test
FROM v_order_touch o
CROSS JOIN LATERAL (VALUES
  ('order', o.last_session_id, o.last_source, o.last_medium, o.last_campaign, o.last_content),
  ('order_first', o.first_session_id, o.first_source, o.first_medium, o.first_campaign, o.first_content)
) k(kind, session_id, source, medium, campaign, content)
LEFT JOIN camp c ON c.campaign_id = k.campaign
LEFT JOIN ad a ON a.ad_id = k.content
UNION ALL
SELECT 'spend', mk_ist_start(sp.day), sp.day, NULL, NULL,
       NULL, NULL,
       COALESCE(lower(sp.campaign), sp.campaign_id),
       COALESCE(lower(sp.ad), NULLIF(sp.ad_id, ''), '(none)'),
       0, CASE WHEN sp.currency = 'INR' THEN sp.spend ELSE 0 END, false, false
FROM ad_spend sp;

-- ── Products ────────────────────────────────────────────────────────────────

-- Everything per product, one row per fact:
--   kind 'view'  a product page view (v_page_views on a /products/ page) and what
--                the visitor did on it: engaged time, gallery depth, scroll, sold-out
--                colour shown, added to cart on that page.
--   kind 'order' an order line of the product (v_order_items).
CREATE VIEW v_products AS
SELECT 'view'::text AS kind, pv.ts, pv.day, pv.product, NULL::text AS title, pv.who, pv.page_view_id,
       NULL::text AS order_id,
       pv.engaged_ms, pv.max_scroll, pv.gallery_depth, pv.zoomed, pv.sold_out, pv.added_to_cart,
       0 AS units, 0::numeric AS revenue_inr,
       pv.is_bot, pv.is_test
FROM v_page_views pv
WHERE pv.product IS NOT NULL
UNION ALL
SELECT 'order', oi.created_at, oi.day, oi.product, oi.title, oi.person_id, NULL,
       oi.order_id,
       NULL, NULL, NULL, NULL, NULL, NULL,
       oi.units, COALESCE(oi.revenue_inr, 0),
       false, oi.is_test
FROM v_order_items oi
WHERE oi.product IS NOT NULL;

-- ── Checkout ────────────────────────────────────────────────────────────────

-- Every checkout-relevant event, plus each live order as step 'order'.
--   in_checkout = it happened on the checkout page (phone/address are also sent by
--   the booking forms and the cart panel; the checkout funnel only counts these).
--   reason / method / coupon / coupon_valid are read from props.
CREATE VIEW v_checkout_steps AS
SELECT e.ts, e.day, e.who, e.session_id, e.name AS step,
       (e.page ~ '/checkout') AS in_checkout,
       e.props->>'reason' AS reason,
       e.props->>'method' AS method,
       upper(e.props->>'code') AS coupon,
       CASE e.props->>'valid' WHEN 'true' THEN true WHEN 'false' THEN false END AS coupon_valid,
       e.value,
       e.is_bot, e.is_test
FROM v_events e
WHERE e.name IN ('add_to_cart', 'cart_view', 'checkout_start', 'otp_sent', 'otp_verified', 'otp_failed',
                 'phone', 'address', 'coupon_apply', 'payment_method', 'payment_start',
                 'payment_success', 'payment_failed')
UNION ALL
SELECT o.created_at, o.day, o.person_id, NULL, 'order', true, NULL, o.payment_method, NULL, NULL,
       o.revenue_inr, false, o.is_test
FROM v_orders o;

-- ── Daily rollups ───────────────────────────────────────────────────────────

-- All three are one row per IST day × (is_bot, is_test) segment. Callers sum the
-- segments they include; every column is additive across segments because a human's
-- flags don't change within a day.

-- The old Firestore counters (legacy_daily), pivoted, for days with no real event at
-- all — the days before the event log existed. 'bot_' / 'hidden_' prefixes were the
-- bot / test buckets. funnel_daily 'visitors' was a first visit, so it becomes
-- new_visitors; analytics_daily 'visit' (once per browser tab) becomes sessions.
CREATE VIEW v_legacy_daily AS
SELECT l.day,
       l.metric LIKE 'bot\_%' AS is_bot,
       l.metric LIKE 'hidden\_%' AS is_test,
       sum(l.value) FILTER (WHERE l.source = 'funnel_daily' AND regexp_replace(l.metric, '^(bot|hidden)_', '') = 'visitors') AS new_visitors,
       sum(l.value) FILTER (WHERE l.source = 'analytics_daily' AND l.metric = 'visit') AS sessions,
       sum(l.value) FILTER (WHERE l.source = 'funnel_daily' AND regexp_replace(l.metric, '^(bot|hidden)_', '') = 'p1') AS p1,
       sum(l.value) FILTER (WHERE l.source = 'funnel_daily' AND regexp_replace(l.metric, '^(bot|hidden)_', '') = 'p2') AS p2,
       sum(l.value) FILTER (WHERE l.source = 'funnel_daily' AND regexp_replace(l.metric, '^(bot|hidden)_', '') = 'p3') AS p3,
       sum(l.value) FILTER (WHERE l.source = 'funnel_daily' AND regexp_replace(l.metric, '^(bot|hidden)_', '') = 'cart') AS cart,
       sum(l.value) FILTER (WHERE l.source = 'funnel_daily' AND regexp_replace(l.metric, '^(bot|hidden)_', '') = 'phone') AS phone,
       sum(l.value) FILTER (WHERE l.source = 'funnel_daily' AND regexp_replace(l.metric, '^(bot|hidden)_', '') = 'address') AS address
FROM legacy_daily l
WHERE l.source IN ('funnel_daily', 'analytics_daily')
  AND NOT EXISTS (
    SELECT 1 FROM events e
    WHERE (e.ts AT TIME ZONE 'Asia/Kolkata')::date = l.day AND NOT e.migrated
  )
GROUP BY 1, 2, 3;

-- Traffic and sales per day (the Overview trend). Cheap: sessions + orders only.
--   visitors        humans with a visit that started that day
--   new_visitors    of those, first ever seen that day (who_first_seen); returning = the rest
--   sessions        visits that started that day
--   orders, revenue_inr   live orders placed that day (bots: never; test: by buyer)
--   legacy          the day's visitors/sessions come from v_legacy_daily; visitors
--                   (which the old counters never had) is NULL
CREATE VIEW v_traffic_daily AS
SELECT day, is_bot, is_test, bool_or(legacy) AS legacy,
       sum(visitors)::bigint AS visitors,
       sum(new_visitors)::bigint AS new_visitors,
       (sum(visitors) - sum(new_visitors))::bigint AS returning_visitors,
       sum(sessions)::bigint AS sessions,
       COALESCE(sum(orders), 0)::bigint AS orders,
       COALESCE(sum(revenue_inr), 0) AS revenue_inr
FROM (
  SELECT s.day, s.is_bot, s.is_test, false AS legacy,
         count(DISTINCT s.who) AS visitors,
         count(DISTINCT s.who) FILTER (WHERE (s.who_first_seen AT TIME ZONE 'Asia/Kolkata')::date = s.day) AS new_visitors,
         count(*) AS sessions,
         NULL::bigint AS orders, NULL::numeric AS revenue_inr
  FROM v_sessions s
  GROUP BY 1, 2, 3
  UNION ALL
  SELECT o.day, false, o.is_test, false, NULL, NULL, NULL, count(*), sum(o.revenue_inr)
  FROM v_orders o
  GROUP BY 1, 2, 3
  UNION ALL
  SELECT l.day, l.is_bot, l.is_test, true, NULL, l.new_visitors, l.sessions, NULL, NULL
  FROM v_legacy_daily l
) x
GROUP BY day, is_bot, is_test;

-- The daily funnel grid: v_traffic_daily plus first-time milestones.
--   p1 / p2 / p3    humans who reached their 1st / 2nd / 3rd DISTINCT product viewed
--                   (product_view events), ever, on that day — milestones: each human
--                   counts once per step, so summing a column over days is meaningful,
--                   as in the old grid
--   cart, checkout_start, phone, address, payment_start
--                   humans doing that for the FIRST time ever, that day
--   On legacy days the steps come from the old counters; the ones they never had
--   (checkout_start, payment_start) are NULL. On real days a step nobody reached is 0.
-- Cost: the milestone part looks up each active human's earlier history (by index,
-- for the days asked for), never the whole table.
CREATE VIEW v_funnel_daily AS
SELECT day, is_bot, is_test, bool_or(legacy) AS legacy,
       sum(visitors)::bigint AS visitors,
       sum(new_visitors)::bigint AS new_visitors,
       sum(returning_visitors)::bigint AS returning_visitors,
       sum(sessions)::bigint AS sessions,
       sum(p1)::bigint AS p1, sum(p2)::bigint AS p2, sum(p3)::bigint AS p3,
       sum(cart)::bigint AS cart,
       sum(checkout_start)::bigint AS checkout_start,
       sum(phone)::bigint AS phone,
       sum(address)::bigint AS address,
       sum(payment_start)::bigint AS payment_start,
       COALESCE(sum(orders), 0)::bigint AS orders,
       COALESCE(sum(revenue_inr), 0) AS revenue_inr
FROM (
  SELECT t.day, t.is_bot, t.is_test, t.legacy, t.visitors, t.new_visitors, t.returning_visitors, t.sessions,
         z AS p1, z AS p2, z AS p3, z AS cart, z AS checkout_start, z AS phone, z AS address, z AS payment_start,
         t.orders, t.revenue_inr
  FROM v_traffic_daily t
  CROSS JOIN LATERAL (SELECT CASE WHEN t.legacy THEN NULL ELSE 0 END::bigint AS z) zz

  UNION ALL

  -- First-time milestones: each human active on a day (real events), compared with
  -- everything they did before it (imported history included, so a Firestore-era
  -- cart isn't counted as a first cart again).
  SELECT d.day, d.is_bot, d.is_test, false,
         NULL, NULL, NULL, NULL,
         count(*) FILTER (WHERE h.products < 1 AND h.products + cardinality(d.products) - h.seen_today >= 1),
         count(*) FILTER (WHERE h.products < 2 AND h.products + cardinality(d.products) - h.seen_today >= 2),
         count(*) FILTER (WHERE h.products < 3 AND h.products + cardinality(d.products) - h.seen_today >= 3),
         count(*) FILTER (WHERE d.cart AND NOT h.cart),
         count(*) FILTER (WHERE d.checkout AND NOT h.checkout),
         count(*) FILTER (WHERE d.phone AND NOT h.phone),
         count(*) FILTER (WHERE d.address AND NOT h.address),
         count(*) FILTER (WHERE d.payment AND NOT h.payment),
         NULL, NULL
  FROM (
    SELECT (e.ts AT TIME ZONE 'Asia/Kolkata')::date AS day, vv.who,
           bool_or(vv.is_bot) AS is_bot, bool_or(vv.is_test) AS is_test,
           COALESCE(array_agg(DISTINCT COALESCE(lower(e.product), mk_handle(e.page)))
             FILTER (WHERE e.name = 'product_view' AND COALESCE(e.product, mk_handle(e.page)) IS NOT NULL), '{}') AS products,
           bool_or(e.name = 'add_to_cart') AS cart,
           bool_or(e.name = 'checkout_start') AS checkout,
           bool_or(e.name = 'phone') AS phone,
           bool_or(e.name = 'address') AS address,
           bool_or(e.name = 'payment_start') AS payment
    FROM events e
    JOIN v_visitors vv ON vv.visitor_id = e.visitor_id
    WHERE e.name IN ('product_view', 'add_to_cart', 'checkout_start', 'phone', 'address', 'payment_start')
      AND NOT e.migrated
    GROUP BY 1, 2
  ) d
  -- Everything this human did before that day: distinct products viewed (and how
  -- many of today's were among them), and which steps they had already reached.
  CROSS JOIN LATERAL (
    SELECT count(DISTINCT COALESCE(lower(e2.product), mk_handle(e2.page))) FILTER (WHERE e2.name = 'product_view') AS products,
           count(DISTINCT COALESCE(lower(e2.product), mk_handle(e2.page)))
             FILTER (WHERE e2.name = 'product_view' AND COALESCE(lower(e2.product), mk_handle(e2.page)) = ANY (d.products)) AS seen_today,
           COALESCE(bool_or(e2.name = 'add_to_cart'), false) AS cart,
           COALESCE(bool_or(e2.name = 'checkout_start'), false) AS checkout,
           COALESCE(bool_or(e2.name = 'phone'), false) AS phone,
           COALESCE(bool_or(e2.name = 'address'), false) AS address,
           COALESCE(bool_or(e2.name = 'payment_start'), false) AS payment
    FROM visitors v2
    JOIN events e2 ON e2.visitor_id = v2.visitor_id
    WHERE (v2.visitor_id = d.who OR v2.person_id = d.who)
      AND e2.name IN ('product_view', 'add_to_cart', 'checkout_start', 'phone', 'address', 'payment_start')
      AND e2.ts < mk_ist_start(d.day)
  ) h
  GROUP BY 1, 2, 3

  UNION ALL

  SELECT l.day, l.is_bot, l.is_test, true, NULL, NULL, NULL, NULL,
         l.p1, l.p2, l.p3, l.cart, NULL, l.phone, l.address, NULL, NULL, NULL
  FROM v_legacy_daily l
) x
GROUP BY day, is_bot, is_test;

-- ── Retention ───────────────────────────────────────────────────────────────

-- Weekly cohorts. cohort_week = the IST week (Monday) a human was first seen
-- (who_first_seen); weeks_since = 0 for that week, 1 for the next, …
--   cohort_size = humans in the cohort (same on every row of the cohort + segment)
--   active      = of them, how many had a visit in that week (week 0 = the cohort
--                 itself, ≈ cohort_size)
--   buyers      = of them, how many placed a live order in that week
-- Only humans with at least one real visit are in a cohort. Built from sessions (not
-- events), so it stays cheap; it covers all history, so filter it by cohort_week.
CREATE VIEW v_cohorts_weekly AS
WITH humans AS (
  SELECT who,
         date_trunc('week', min(who_first_seen) AT TIME ZONE 'Asia/Kolkata')::date AS cohort_week,
         bool_or(is_bot) AS is_bot,
         bool_or(is_test) AS is_test
  FROM v_sessions
  GROUP BY who
), size AS (
  SELECT cohort_week, is_bot, is_test, count(*) AS cohort_size
  FROM humans GROUP BY 1, 2, 3
), acts AS (
  SELECT DISTINCT s.who, date_trunc('week', s.started_at AT TIME ZONE 'Asia/Kolkata')::date AS week, 'visit'::text AS what
  FROM v_sessions s
  UNION
  SELECT DISTINCT o.person_id, date_trunc('week', o.created_at AT TIME ZONE 'Asia/Kolkata')::date, 'order'
  FROM v_orders o WHERE o.person_id IS NOT NULL
)
SELECT h.cohort_week,
       ((a.week - h.cohort_week) / 7) AS weeks_since,
       h.is_bot,
       h.is_test,
       sz.cohort_size,
       count(*) FILTER (WHERE a.what = 'visit') AS active,
       count(*) FILTER (WHERE a.what = 'order') AS buyers
FROM humans h
JOIN acts a ON a.who = h.who AND a.week >= h.cohort_week
JOIN size sz ON sz.cohort_week = h.cohort_week AND sz.is_bot = h.is_bot AND sz.is_test = h.is_test
GROUP BY 1, 2, 3, 4, 5;

-- ── Tracking health ─────────────────────────────────────────────────────────

-- Is collection working? One row per IST day × kind × name:
--   kind 'event'   real events received, per event name (n), and how many were bots
--   kind 'reject'  payloads /api/collect refused, per reason (collect_rejects)
--   kind 'order'   live orders mirrored from Shopify, per store (for parity checks)
CREATE VIEW v_tracking_health AS
SELECT (e.ts AT TIME ZONE 'Asia/Kolkata')::date AS day, 'event'::text AS kind, e.name,
       count(*) AS n, count(*) FILTER (WHERE e.is_bot) AS bots
FROM events e
WHERE NOT e.migrated
GROUP BY 1, 3
UNION ALL
SELECT r.day, 'reject', r.reason, sum(r.n), 0
FROM collect_rejects r
GROUP BY 1, 3
UNION ALL
SELECT o.day, 'order', o.store, count(*), 0
FROM v_orders o
GROUP BY 1, 3;
