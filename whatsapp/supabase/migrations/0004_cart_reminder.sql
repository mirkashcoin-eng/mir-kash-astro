-- Mir Kash WhatsApp — Phase 1.3: abandoned-cart reminders move into this service.
--
-- The website used to send the cart_reminder template from a Vercel cron. Now this service
-- does (functions/wa-cart-reminder), so every outbound WhatsApp message comes from one place.
--   cart_reminders  one row per Shopify draft order we've reminded (the "once per draft" lock)
--   wa_settings     small key/value config; cart_reminder_from = only drafts created after this
--                   time are eligible, so nobody the old website cron already reminded gets a
--                   second message at the switch-over.
--   template_map    + a cart_reminder row (the approved MARKETING template)
-- Safe + additive, safe to run twice. RLS on, no policies, service_role only (as in 0001).

create table if not exists cart_reminders (
  draft_id    text primary key,                 -- Shopify draft order gid
  store_domain text,
  to_phone    text,
  sent_at     timestamptz not null default now()
);

create table if not exists wa_settings (
  key   text primary key,
  value text not null
);

alter table cart_reminders enable row level security;
alter table wa_settings    enable row level security;
revoke all on table cart_reminders, wa_settings from anon, authenticated;
grant select, insert, update, delete on table cart_reminders, wa_settings to service_role;

insert into wa_settings (key, value) values ('cart_reminder_from', now()::text)
on conflict (key) do nothing;

insert into template_map (store_domain, event_key, template_name, language_code)
select store_domain, 'cart_reminder', 'cart_reminder', 'en' from store_config
on conflict (store_domain, event_key) do update set
  template_name = excluded.template_name, language_code = excluded.language_code, is_active = true;

notify pgrst, 'reload schema';
