# WA-1: Supabase migration and PostgREST store

**Owns:** `whatsapp/supabase/migrations/0003_inbox.sql`, `src/lib/whatsapp-store.ts`, a new section in `whatsapp/README.md`.
**Contract:** `src/lib/whatsapp-types.ts` (`WaOutRow`, `WaInboundRow`, `WaStatusRow`, `WaContactRow`, `WaThreadRow`, `WaMessageRow`). Keep the stub's exported signatures exactly as they are.

## Background
The WhatsApp service is a separate Supabase project, documented in `whatsapp/README.md`. Read the README and both existing migrations. Every send is logged to `messages_out`, written by `whatsapp/supabase/functions/shopify-webhook/index.ts`. Don't change that function, and don't change anything it writes or reads in a way that would break its insert.

## 1. Migration `0003_inbox.sql`
It only adds things, and running it twice is safe (`if not exists` everywhere). Write the same header-comment style as `0002_retry_queue.sql`.
- **`messages_out`:** add `phone_number_id text`, `source text not null default 'order'`, `kind text not null default 'template'`, `body text`, `sent_by text`. Add an index on `(to_phone, created_at desc)` and a **non-unique** index on `meta_message_id`.
- **`messages_in`:** `id uuid pk default gen_random_uuid()`, `meta_message_id text unique not null`, `from_phone text not null`, `phone_number_id text`, `kind text not null`, `body text`, `media_id text`, `media_mime text`, `reply_to text`, `received_at timestamptz not null`, `raw jsonb`, `created_at timestamptz default now()`. Add an index on `(from_phone, received_at desc)`.
- **`message_status`:** `meta_message_id text pk`, `recipient_phone text`, `phone_number_id text`, `sent_at`, `delivered_at`, `read_at`, `failed_at timestamptz`, `failed_reason text`, `updated_at timestamptz default now()`.
- **`wa_contacts`:** `phone text pk`, `profile_name text`, `last_read_at timestamptz`, `updated_at timestamptz default now()`.
- **`upsert_wa_statuses(rows jsonb)` RPC function** (plpgsql, `security invoker`): for each `WaStatusRow`, insert or update `message_status`. Each timestamp column takes `coalesce(existing, new)`, so it's set once and never moved, because receipts arrive out of order. `failed_reason` takes the latest non-null value. That way the store makes a single `POST /rpc/upsert_wa_statuses` call.
- **View `wa_messages`** (`with (security_invoker = true)`): the union of
  - **out rows:** `messages_out`, with `id = coalesce(meta_message_id, 'out:'||id)`, `phone = to_phone`, `direction 'out'`, `kind`, `source`, `template_name`, `request`, `body`, null media, null `reply_to`, `sent_by`, `at = created_at`, `send_status = status`, `send_error = case when status='failed' then response end`, and the `message_status` columns left-joined on `meta_message_id`;
  - **in rows:** `messages_in`, with `direction 'in'`, `source 'customer'`, and nulls where they don't apply.

  Column names and order must match `WaMessageRow`. Ignore `messages_out` rows whose `to_phone` is null.
- **View `wa_threads`** (`security_invoker = true`): one row per phone over `wa_messages`, matching `WaThreadRow`.
  - `last_*` comes from the latest message (use `distinct on (phone) … order by phone, at desc`, or a lateral join).
  - `last_inbound_at` is the max `at` where `direction='in'`.
  - `reply_number_id` is the `phone_number_id` of the latest `messages_in` row.
  - `unread` is the count of in rows after `coalesce(wa_contacts.last_read_at, '-infinity')`.
  - `total` is the count of all messages.
  - `profile_name` comes from `wa_contacts`.
- **Access:** enable RLS on the 3 new tables with no policies. `revoke all` on the new tables and views from `anon, authenticated`. `grant` the needed privileges on them, plus `execute` on the function, to `service_role`. Add the `messages_out` re-grant from the README's gotcha section, and end with `notify pgrst, 'reload schema';`.

## 2. `src/lib/whatsapp-store.ts`
- Replace the stub bodies with real code. Use plain `fetch` to `${WA_SUPABASE_URL}/rest/v1/...` with headers `apikey` and `Authorization: Bearer ${WA_SUPABASE_SERVICE_KEY}`. Read the env vars through the same `env()` helper as `src/lib/db.ts`.
- Use a 10s `AbortController` timeout. On a non-2xx response, `console.error('[wa-store] …', status, body.slice(0,300))` and return null or false. It never throws.
- `waStoreConfigured()` is true when both env vars are set. Every other function returns null or false straight away when it's false, **with no log line**.
- **`listThreadRows`**:
  - `GET /wa_threads?select=*&order=last_at.desc&limit=N`;
  - `before` adds `last_at=lt.<iso>`;
  - `filter='replied'` adds `last_inbound_at=not.is.null`, and `'unread'` adds `unread=gt.0`;
  - `q` (trimmed, at most 60 characters, with PostgREST-reserved characters `,()*` stripped) becomes `or=(phone.ilike.*q*,profile_name.ilike.*q*,last_body.ilike.*q*)`. If `q` has 3 or more digits, match its digits against `phone`.
- **`listMessageRows`**: `GET /wa_messages?phone=eq.<p>&order=at.desc&limit=N`, plus `at=lt.` when there's a cursor.
- **`lastInbound`**: `GET /messages_in?from_phone=eq.<p>&select=received_at,phone_number_id&order=received_at.desc&limit=1`.
- **`markRead`**: `POST /wa_contacts` with `Prefer: resolution=merge-duplicates` and body `{ phone, last_read_at, updated_at }`.
- **`insertOut`**: `POST /messages_out`. Drop `undefined` keys before sending.
- **`upsertInbound`**: `POST /messages_in?on_conflict=meta_message_id` with `Prefer: resolution=ignore-duplicates`. With no rows, return true.
- **`upsertStatuses`**: `POST /rpc/upsert_wa_statuses` with body `{ rows }`.
- **`upsertContacts`**: drop rows with a null `profile_name`, then merge-duplicates upsert `{ phone, profile_name, updated_at }`. Because rows without a name are dropped, a known name is never cleared and `last_read_at` is never touched.
- Phone arguments are digits only. Strip anything else defensively before building URLs, and URL-encode every value.

## 3. README
Add an "Inbox (Phase 1.2)" section to `whatsapp/README.md` covering:
- what 0003 adds;
- how to run it in the SQL Editor;
- the new Vercel env vars `WA_SUPABASE_URL` and `WA_SUPABASE_SERVICE_KEY` (the legacy `service_role` key, server-only);
- that the Meta webhook (on the website, `/api/webhooks/whatsapp`) now writes inbound replies and receipts here.

## Acceptance
- The SQL parses. If Docker and the Supabase CLI aren't available, at least check the syntax with a careful read, and make sure every column referenced in the views exists in 0001, 0002 or 0003.
- `tsc` shows no new errors.
- In the commit message, briefly note any judgement calls you made, for example around PostgREST quoting.
