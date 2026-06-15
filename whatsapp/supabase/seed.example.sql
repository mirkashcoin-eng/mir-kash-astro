-- Seed the India store. Fill in the two PASTE_… values, then run this in the
-- Supabase SQL editor (Dashboard → SQL Editor → paste → Run).
-- Do NOT commit a copy with the real webhook secret in it.

insert into store_config
  (store_domain, label, shopify_webhook_secret, meta_phone_number_id, default_language, require_optin, is_active)
values
  (
    'e8601g-8a.myshopify.com',                 -- confirm the India store's *.myshopify.com domain
    'india',
    'PASTE_SHOPIFY_WEBHOOK_SIGNING_SECRET',    -- from Shopify → Settings → Notifications → Webhooks
    '1162880016911789',                        -- Meta WhatsApp phone number ID (India)
    'en_US',
    false,                                     -- flip to true after the checkout opt-in checkbox ships
    true
  )
on conflict (store_domain) do update set
  shopify_webhook_secret = excluded.shopify_webhook_secret,
  meta_phone_number_id   = excluded.meta_phone_number_id,
  is_active              = excluded.is_active;

-- event_key → the EXACT approved Meta template name (lowercase + underscores).
insert into template_map (store_domain, event_key, template_name, language_code) values
  ('e8601g-8a.myshopify.com', 'order_confirmed',  'order_confirmed',  'en_US'),
  ('e8601g-8a.myshopify.com', 'cod_confirmation', 'cod_confirmation', 'en_US'),
  ('e8601g-8a.myshopify.com', 'order_shipped',    'order_shipped',    'en_US')
on conflict (store_domain, event_key) do update set
  template_name = excluded.template_name,
  language_code = excluded.language_code,
  is_active     = true;
