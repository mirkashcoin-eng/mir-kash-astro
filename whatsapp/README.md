# Mir Kash WhatsApp — Phase 1 (outbound order notifications)

Sends WhatsApp messages when a Shopify order is **placed** (or COD placed) or **shipped**, for the **India**
store. Self-contained: a Supabase database + one Edge Function. Nothing here touches the website.

```
Shopify order event  →  shopify-webhook (Supabase Edge Function)  →  Meta WhatsApp Cloud API  →  customer
```

- `orders/create`  → `order_confirmed` (prepaid) or `cod_confirmation` (COD)
- `orders/fulfilled` → `order_shipped` (with tracking)

---

## What's in here
```
supabase/
  config.toml                      # project ref + verify_jwt=false for the webhook
  migrations/0001_phase1_schema.sql# tables (RLS on, service-role only)
  seed.example.sql                 # India store_config + template_map (fill the secret, then run)
  functions/
    _shared/shopify.ts             # HMAC verify, phone normalise, event mapping, field extraction
    _shared/meta.ts                # Meta Cloud API send-template helper
    shopify-webhook/index.ts       # the function
templates/TEMPLATES.md             # the 3 messages to submit to Meta for approval
.env.example                       # the one secret you set (META_ACCESS_TOKEN)
```

---

## Prerequisites
- Supabase project (done): ref `btupzwyyqdkzfoygfwcz`.
- Meta WhatsApp app with a **permanent access token** (System User token — not the 24h temporary one),
  the **phone number ID** (`1162880016911789`) and a verified **test recipient** for testing.
- Admin access to the **India Shopify store** (to create webhooks + copy the signing secret).
- Supabase CLI: <https://supabase.com/docs/guides/cli> (`npm i -g supabase` or `scoop install supabase`).

---

## Deploy — step by step

**1. Link the project**
```bash
cd mirkash-whatsapp
supabase login
supabase link --project-ref btupzwyyqdkzfoygfwcz
```

**2. Create the tables**
Easiest: open **Dashboard → SQL Editor**, paste the contents of `supabase/migrations/0001_phase1_schema.sql`, Run.
(Or `supabase db push` if you use migrations.)

**3. Set the function secret** (the permanent Meta token)
```bash
supabase secrets set META_ACCESS_TOKEN=EAAxxxxx_your_permanent_token
# optional: supabase secrets set META_API_VERSION=v21.0

# OPTIONAL — only needed for the refund message (refunds/create webhook lacks the
# phone + order number, so the function looks the order up via the India Admin API).
# The other 4 messages work WITHOUT these.
supabase secrets set SHOPIFY_IN_ADMIN_DOMAIN=e8601g-8a.myshopify.com
supabase secrets set SHOPIFY_IN_ADMIN_CLIENT_ID=xxxx
supabase secrets set SHOPIFY_IN_ADMIN_CLIENT_SECRET=xxxx
```
`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are provided automatically — don't set them.

**4. Deploy the function** (JWT off so Shopify can call it)
```bash
supabase functions deploy shopify-webhook --no-verify-jwt
```
Your function URL is:
```
https://btupzwyyqdkzfoygfwcz.supabase.co/functions/v1/shopify-webhook
```

**5. Create the Shopify webhooks** (India admin)
Settings → Notifications → **Webhooks** → Create webhook, for **each** topic:
- **Order creation** (`orders/create`) → order_confirmed / cod_confirmation
- **Order fulfilled** (`orders/fulfilled`) → order_shipped
- **Order cancelled** (`orders/cancelled`) → order_cancelled
- **Refund created** (`refunds/create`) → refund_processed *(needs the optional admin secrets in step 3)*

For all: **Format = JSON**, **URL =** the function URL above. Save.
At the bottom of that Webhooks page Shopify shows one **signing secret** for the store — copy it.

**6. Seed the store row**
Open `supabase/seed.example.sql`, paste the **signing secret** into `shopify_webhook_secret` (confirm the
`store_domain`), then run it in the SQL Editor.

**7. Submit the templates**
Create the 5 templates from `templates/TEMPLATES.md` in WhatsApp Manager and wait for approval (Utility templates
usually approve fast). The names already match the seed.

---

## Test
1. Add your phone as a **verified test recipient** in Meta (test numbers can only message verified testers).
2. Place a small **test order** on the India store (real, then cancel/refund) — or fulfil an order to test shipped.
3. The WhatsApp message should arrive. Check the data:
   - **Dashboard → Table editor → `webhook_events`** — a row, `status = processed`.
   - **`messages_out`** — a row, `status = sent`, with `meta_message_id`.
   - On failure, `messages_out.response` holds Meta's error; `webhook_events.status = error`.

**Quick sanity checks**
- A bad/missing signature → the function returns **401** (won't process).
- The same webhook delivered twice → second one is **skipped** (idempotency on `X-Shopify-Webhook-Id`).

---

## Go live
- Get **business verification** done and add the **production number** in Meta.
- Update `store_config.meta_phone_number_id` to the production number's ID.
- (Optional) once the checkout opt-in checkbox ships, set `store_config.require_optin = true`.

---

## Retry queue — automatic replay of failed sends (`wa-retry`)
Every event is stored durably in `webhook_events`, so a failed Meta send is never lost — it just sits at
`status = 'error'`. The **`wa-retry`** worker drains that queue: on a schedule it re-attempts each failed event
(up to **5** tries, within a **3-day** window) and marks it `processed` once it goes through. This is what makes
`webhook_events` a real queue rather than just a log — no separate queue service needed.

It's **add-only**: it reuses the same `_shared` helpers + `template_map` as `shopify-webhook` and never touches the
live webhook path. Deploy it once:

**1. Add the retry-count column** (SQL Editor, or `supabase db push`):
```sql
-- supabase/migrations/0002_retry_queue.sql
alter table webhook_events add column if not exists retry_count int not null default 0;
```
**2. Set the worker's secret**
```bash
supabase secrets set RETRY_SECRET=<a-random-string>
```
**3. Deploy** (JWT off — a scheduler calls it, gated by the secret)
```bash
supabase functions deploy wa-retry --no-verify-jwt
```
**4. Schedule it** every ~10 min. Either Supabase's built-in cron (Dashboard → Edge Functions → Schedules) or an
external one (cron-job.org), hitting:
```
https://btupzwyyqdkzfoygfwcz.supabase.co/functions/v1/wa-retry?key=<RETRY_SECRET>
```
Each run returns `{ scanned, processed, skipped, stillFailing }`. After 5 failed tries a row is left `error` for you
to inspect. To find stuck events manually:
```sql
select id, topic, order_id, status, retry_count, error_message, received_at
from webhook_events where status = 'error' order by received_at desc;
```

---

## Notes
- Tables are **backend-only** (RLS on, no policies) — only the service-role key (used by the function) can read
  them. The public key can touch nothing.
- This project deploys to **Supabase**, not Vercel — it's independent of the `mir-kash-astro` website.
- Multi-store ready: to add Global later, insert another `store_config` + `template_map` rows and point that
  store's Shopify webhooks at the same function URL.

## Gotchas on a "new API keys" project (learned during first deploy)
- Edge Functions may not get a working auto-injected `SUPABASE_SERVICE_ROLE_KEY`. The function therefore prefers an
  explicit **`SUPA_SERVICE_KEY`** secret (set it to the project's legacy `service_role` key) and falls back to the
  injected one.
- If **"Automatically expose new tables"** was OFF at project creation, the 4 tables aren't granted to the API
  roles, so even `service_role` reads return empty via the Data API. Fix once:
  ```sql
  grant usage on schema public to service_role;
  grant all privileges on table store_config, template_map, webhook_events, messages_out to service_role;
  notify pgrst, 'reload schema';
  ```

---

## Inbox (Phase 1.2) — replies and receipts for `/admin/whatsapp`
The website now has a WhatsApp inbox at `/admin/whatsapp`: one conversation per customer, every message sent
(by this service, by the website, or as a reply from the inbox), customer replies, and ✓/✓✓/blue ticks. All of it
lives **here in Supabase**; the website reads and writes it over the Data API with the `service_role` key.

**What `0003_inbox.sql` adds** (add-only, safe to run twice — `shopify-webhook` and `wa-retry` keep working unchanged):
- `messages_out` gets `phone_number_id`, `source` (`order` | `site` | `inbox`, default `order`), `kind`
  (`template` | `text`, default `template`), `body` and `sent_by`, plus indexes on `(to_phone, created_at desc)` and
  `meta_message_id` (deliberately **not** unique, so this service's own insert can never fail on it).
- `messages_in` — customer messages (text, photos, voice notes, buttons…), unique on the wamid because Meta retries.
- `message_status` — delivery receipts per wamid (`sent_at`, `delivered_at`, `read_at`, `failed_at`, `failed_reason`).
  A separate table, so a receipt that arrives before its `messages_out` row is never lost.
- `wa_contacts` — the customer's WhatsApp profile name and the founders' shared "last read" marker.
- `upsert_wa_statuses(rows jsonb)` — merges a batch of receipts; each timestamp is set once and never moved.
- Views `wa_messages` (sent ∪ received, receipts joined) and `wa_threads` (one row per phone, for the list).
- Same access model as 0001: RLS on, no policies, granted to `service_role` only.

**Run it:** Dashboard → **SQL Editor** → paste the contents of `supabase/migrations/0003_inbox.sql` → **Run**
(or `supabase db push`). It ends with `notify pgrst, 'reload schema'`, so the new tables show up in the Data API
straight away. Quick check:
```sql
select count(*) from wa_threads;   -- one row per phone already in messages_out
```

**Website env vars (Vercel → Settings → Environment Variables, server-only — never `PUBLIC_`):**
```
WA_SUPABASE_URL=https://btupzwyyqdkzfoygfwcz.supabase.co
WA_SUPABASE_SERVICE_KEY=<the legacy service_role key>   # Project Settings → API Keys (legacy keys)
```
Without them the inbox shows "not set up yet" and the website quietly skips logging — nothing breaks.

**Who writes what:**
- The **Meta webhook on the website** (`/api/webhooks/whatsapp`, signed with `WHATSAPP_APP_SECRET`) now stores
  inbound replies in `messages_in`, profile names in `wa_contacts`, and delivered/read/failed receipts in
  `message_status` — including receipts for the messages this service sends. This service doesn't receive Meta
  webhooks itself.
- The website's own sends (cart reminder, checkout confirmation) are logged to `messages_out` with `source = 'site'`,
  and inbox replies with `source = 'inbox'`, `kind = 'text'` and `sent_by` = the founder's email.
- For receipts and replies to reach the webhook, the sending number must be in the **same Meta app** whose webhook
  points at the website, with the **messages** field subscribed.

---

## One sender: everything goes out from this service (Phase 1.3)
Every template message now comes from here; the website only sends a founder's free-text reply from
`/admin/whatsapp`.

| Message | Trigger | Function |
|---|---|---|
| order_confirmed / cod_confirmation | Shopify `orders/create` | `shopify-webhook` |
| order_shipped (`order_shipped_v2`) | Shopify `orders/fulfilled` | `shopify-webhook` |
| order_cancelled / refund_processed | Shopify `orders/cancelled` / `refunds/create` | `shopify-webhook` |
| cart_reminder | schedule (hourly) | `wa-cart-reminder` |
| retries of failed sends | schedule (every 10 min) | `wa-retry` |

`wa-cart-reminder` finds open checkout drafts tagged `web-otp` + `wa-optin`, 2h–7d old, created after
`wa_settings.cart_reminder_from`, and reminds each once (`cart_reminders` is the lock). Needs the
`SHOPIFY_IN_ADMIN_*` secrets. `?dry=1` reports what it would send.

Both scheduled functions are gated by the `RETRY_SECRET` secret. pg_cron reads the same value from
Vault (`wa_cron_secret`), so it never appears in SQL. Migration: `0004_cart_reminder.sql`.
