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

## Replay a failed send
Failed sends are kept in the logs (we never rely on Shopify retries). To resend, find the event:
```sql
select id, topic, order_id, status, error_message, received_at
from webhook_events where status = 'error' order by received_at desc;
```
Re-trigger from Shopify (the webhook page can resend a test), or re-post the stored `payload` to the function URL
with a fresh `X-Shopify-Webhook-Id`. (A one-click replay endpoint is a Phase 1.1 nicety.)

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
