-- Mir Kash WhatsApp — Phase 1.2: the inbox (/admin/whatsapp on the website).
--
-- Until now only sends were stored (messages_out); customer replies hit the Meta webhook
-- and were thrown away. This migration adds what the website's inbox needs to show one
-- conversation per customer and let a founder reply inside the 24h window:
--   messages_out   + phone_number_id / source / kind / body / sent_by (all defaulted, so
--                    the shopify-webhook and wa-retry inserts keep working unchanged)
--   messages_in    customer messages, written by the website's Meta webhook
--   message_status delivery receipts (sent / delivered / read / failed), keyed by wamid
--   wa_contacts    WhatsApp profile names + the founders' shared "last read" marker
--   upsert_wa_statuses(rows)  merges a batch of receipts in one call
--   wa_messages    view: out ∪ in as one stream, receipts joined
--   wa_threads     view: one row per phone, for the conversation list
-- Safe + additive, and safe to run twice. Same access model as 0001: RLS on, no
-- policies, service_role only.

-- ── messages_out: a few more columns for the inbox ─────────────────────────────────
-- source: order (this service) | site (the website's sendTemplate) | inbox (a reply)
-- kind:   template | text
alter table messages_out add column if not exists phone_number_id text;
alter table messages_out add column if not exists source          text not null default 'order';
alter table messages_out add column if not exists kind            text not null default 'template';
alter table messages_out add column if not exists body            text;
alter table messages_out add column if not exists sent_by         text;   -- founder email (inbox replies)

create index if not exists idx_messages_out_phone on messages_out (to_phone, created_at desc);
-- NOT unique: a unique index could make this service's own insert fail.
create index if not exists idx_messages_out_wamid on messages_out (meta_message_id);

-- ── messages_in: every customer message (Meta retries → unique on the wamid) ───────
create table if not exists messages_in (
  id              uuid primary key default gen_random_uuid(),
  meta_message_id text unique not null,
  from_phone      text not null,                          -- digits with country code
  phone_number_id text,                                   -- the business number they wrote to
  kind            text not null,                          -- text | image | audio | video | document | sticker | location | reaction | button | unsupported
  body            text,                                   -- text, caption, button title, emoji, "lat,lng"
  media_id        text,
  media_mime      text,
  reply_to        text,                                   -- wamid of the message they quoted
  received_at     timestamptz not null,
  raw             jsonb,
  created_at      timestamptz default now()
);
create index if not exists idx_messages_in_phone on messages_in (from_phone, received_at desc);

-- ── message_status: delivery receipts, one row per wamid ───────────────────────────
-- Its own table (not columns on messages_out) so a receipt that arrives before the
-- messages_out row is never lost and never collides with this service's insert.
create table if not exists message_status (
  meta_message_id text primary key,
  recipient_phone text,
  phone_number_id text,
  sent_at         timestamptz,
  delivered_at    timestamptz,
  read_at         timestamptz,
  failed_at       timestamptz,
  failed_reason   text,
  updated_at      timestamptz default now()
);

-- ── wa_contacts: profile name from the webhook + shared "seen" marker ──────────────
create table if not exists wa_contacts (
  phone        text primary key,
  profile_name text,
  last_read_at timestamptz,
  updated_at   timestamptz default now()
);

alter table messages_in    enable row level security;
alter table message_status enable row level security;
alter table wa_contacts    enable row level security;

-- ── upsert_wa_statuses: merge a batch of WaStatusRow receipts ──────────────────────
-- rows = [{ meta_message_id, recipient_phone, phone_number_id, status, at, error }].
-- Receipts arrive out of order (read before delivered, retries), so every timestamp is
-- set once and never moved: coalesce(existing, new). failed_reason keeps the latest
-- non-null value. A row-by-row loop (not one INSERT … SELECT) so two receipts for the
-- same wamid in one batch don't hit "cannot affect row a second time".
create or replace function upsert_wa_statuses(rows jsonb)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  r  jsonb;
  st text;
  ts timestamptz;
  n  integer := 0;
begin
  if rows is null or jsonb_typeof(rows) <> 'array' then
    return 0;
  end if;
  for r in select value from jsonb_array_elements(rows) loop
    st := r->>'status';
    if coalesce(r->>'meta_message_id', '') = '' or st not in ('sent', 'delivered', 'read', 'failed') then
      continue;
    end if;
    begin
      ts := (r->>'at')::timestamptz;
    exception when others then
      ts := null;
    end;
    ts := coalesce(ts, now());

    insert into message_status as ms
      (meta_message_id, recipient_phone, phone_number_id,
       sent_at, delivered_at, read_at, failed_at, failed_reason, updated_at)
    values (
      r->>'meta_message_id',
      nullif(r->>'recipient_phone', ''),
      nullif(r->>'phone_number_id', ''),
      case when st = 'sent'      then ts end,
      case when st = 'delivered' then ts end,
      case when st = 'read'      then ts end,
      case when st = 'failed'    then ts end,
      case when st = 'failed'    then nullif(r->>'error', '') end,
      now()
    )
    on conflict (meta_message_id) do update set
      recipient_phone = coalesce(ms.recipient_phone, excluded.recipient_phone),
      phone_number_id = coalesce(ms.phone_number_id, excluded.phone_number_id),
      sent_at         = coalesce(ms.sent_at,      excluded.sent_at),
      delivered_at    = coalesce(ms.delivered_at, excluded.delivered_at),
      read_at         = coalesce(ms.read_at,      excluded.read_at),
      failed_at       = coalesce(ms.failed_at,    excluded.failed_at),
      failed_reason   = coalesce(excluded.failed_reason, ms.failed_reason),
      updated_at      = now();
    n := n + 1;
  end loop;
  return n;
end;
$$;

-- ── wa_messages: one stream per phone (columns = WaMessageRow in whatsapp-types.ts) ─
create or replace view wa_messages with (security_invoker = true) as
  select
    coalesce(mo.meta_message_id, 'out:' || mo.id::text)               as id,
    mo.to_phone                                                       as phone,
    'out'::text                                                       as direction,
    mo.kind                                                           as kind,
    mo.source                                                         as source,
    mo.template_name                                                  as template_name,
    mo.request                                                        as request,
    mo.body                                                           as body,
    null::text                                                        as media_id,
    null::text                                                        as media_mime,
    null::text                                                        as reply_to,
    mo.sent_by                                                        as sent_by,
    mo.created_at                                                     as at,
    mo.status                                                         as send_status,
    case when mo.status = 'failed' then mo.response end               as send_error,
    ms.delivered_at                                                   as delivered_at,
    ms.read_at                                                        as read_at,
    ms.failed_at                                                      as failed_at,
    ms.failed_reason                                                  as failed_reason
  from messages_out mo
  left join message_status ms on ms.meta_message_id = mo.meta_message_id
  where mo.to_phone is not null
union all
  select
    mi.meta_message_id,
    mi.from_phone,
    'in'::text,
    mi.kind,
    'customer'::text,
    null::text,
    null::jsonb,
    mi.body,
    mi.media_id,
    mi.media_mime,
    mi.reply_to,
    null::text,
    mi.received_at,
    null::text,
    null::jsonb,
    null::timestamptz,
    null::timestamptz,
    null::timestamptz,
    null::text
  from messages_in mi;

-- ── wa_threads: one row per phone (columns = WaThreadRow in whatsapp-types.ts) ─────
create or replace view wa_threads with (security_invoker = true) as
  with latest as (
    select distinct on (m.phone)
      m.phone, m.at, m.direction, m.kind, m.body, m.template_name, m.request
    from wa_messages m
    order by m.phone, m.at desc, m.id desc
  ),
  agg as (
    select
      m.phone,
      count(*)::int                                   as total,
      max(m.at) filter (where m.direction = 'in')     as last_inbound_at
    from wa_messages m
    group by m.phone
  )
  select
    l.phone                                                     as phone,
    c.profile_name                                              as profile_name,
    l.at                                                        as last_at,
    l.direction                                                 as last_direction,
    l.kind                                                      as last_kind,
    l.body                                                      as last_body,
    l.template_name                                             as last_template,
    case when l.direction = 'out' then l.request end            as last_request,
    a.last_inbound_at                                           as last_inbound_at,
    (select mi.phone_number_id
       from messages_in mi
      where mi.from_phone = l.phone
      order by mi.received_at desc
      limit 1)                                                  as reply_number_id,
    (select count(*)::int
       from messages_in mi
      where mi.from_phone = l.phone
        and mi.received_at > coalesce(c.last_read_at, '-infinity'::timestamptz)) as unread,
    a.total                                                     as total
  from latest l
  join agg a on a.phone = l.phone
  left join wa_contacts c on c.phone = l.phone;

-- ── Access: backend-only, service_role only ────────────────────────────────────────
revoke all on table messages_in, message_status, wa_contacts, wa_messages, wa_threads from anon, authenticated;
revoke all on function upsert_wa_statuses(jsonb) from public, anon, authenticated;

grant usage on schema public to service_role;
grant select, insert, update, delete on table messages_in, message_status, wa_contacts to service_role;
grant select on table wa_messages, wa_threads to service_role;
grant execute on function upsert_wa_statuses(jsonb) to service_role;
-- The README's "new API keys" gotcha: re-grant the Phase 1 tables (incl. messages_out,
-- which now has new columns) in case "Automatically expose new tables" was off.
grant all privileges on table store_config, template_map, webhook_events, messages_out to service_role;

notify pgrst, 'reload schema';
