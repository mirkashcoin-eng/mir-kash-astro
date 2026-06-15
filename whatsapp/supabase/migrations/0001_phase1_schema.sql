-- Mir Kash WhatsApp — Phase 1 (outbound order notifications) schema.
-- All tables are BACKEND-ONLY: Row Level Security is ON with NO policies, so only
-- the service_role key (used by the Edge Function) can read/write them. The public
-- anon/publishable key can touch nothing here.

create extension if not exists pgcrypto;

-- One row per Shopify store we serve (India in Phase 1; Global later).
create table if not exists store_config (
  id                     uuid primary key default gen_random_uuid(),
  store_domain           text unique not null,            -- the *.myshopify.com domain (matches X-Shopify-Shop-Domain)
  label                  text not null,                   -- 'india'
  shopify_webhook_secret text not null,                   -- Shopify webhook signing secret (verifies incoming webhooks)
  meta_phone_number_id   text not null,                   -- Meta WhatsApp phone number ID
  default_language       text not null default 'en_US',
  require_optin          boolean not null default false,  -- when true, only send if the order carries the opt-in marker
  is_active              boolean not null default true,
  created_at             timestamptz not null default now()
);

-- Maps a store + event to an APPROVED Meta template.
create table if not exists template_map (
  id            uuid primary key default gen_random_uuid(),
  store_domain  text not null references store_config(store_domain) on delete cascade,
  event_key     text not null,                            -- 'order_confirmed' | 'cod_confirmation' | 'order_shipped'
  template_name text not null,                            -- the EXACT approved Meta template name
  language_code text not null default 'en_US',
  is_active     boolean not null default true,
  unique (store_domain, event_key)
);

-- Every incoming Shopify webhook — gives idempotency, replay and debugging.
create table if not exists webhook_events (
  id               uuid primary key default gen_random_uuid(),
  store_domain     text,
  topic            text,
  shopify_event_id text unique,                           -- X-Shopify-Webhook-Id (the idempotency key)
  order_id         text,
  payload          jsonb,
  status           text not null default 'received',      -- received | processed | skipped | error
  error_message    text,
  received_at      timestamptz not null default now(),
  processed_at     timestamptz
);

-- Every outbound WhatsApp send — debugging + proof of delivery.
create table if not exists messages_out (
  id              uuid primary key default gen_random_uuid(),
  store_domain    text,
  event_key       text,
  to_phone        text,
  template_name   text,
  meta_message_id text,
  status          text not null,                          -- sent | failed
  request         jsonb,
  response        jsonb,
  created_at      timestamptz not null default now()
);

-- Lock every table to the service_role (backend) only — RLS on, zero policies.
alter table store_config   enable row level security;
alter table template_map   enable row level security;
alter table webhook_events enable row level security;
alter table messages_out   enable row level security;

create index if not exists idx_webhook_events_received on webhook_events (received_at desc);
create index if not exists idx_webhook_events_status   on webhook_events (status);
create index if not exists idx_messages_out_created    on messages_out (created_at desc);
