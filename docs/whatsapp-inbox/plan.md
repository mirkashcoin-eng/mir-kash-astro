# WhatsApp inbox at /admin/whatsapp

Tickets: [tickets/README.md](tickets/README.md). Shared contract: [src/lib/whatsapp-types.ts](../../src/lib/whatsapp-types.ts).

## Context
The Supabase WhatsApp service (`whatsapp/`) sends order messages and logs each one to `messages_out` in Supabase. The site's cart-reminder cron ([src/pages/api/cron/whatsapp.ts](src/pages/api/cron/whatsapp.ts)) also sends, but doesn't log anything except a Firestore dedupe lock. Customer replies reach the Meta webhook at [src/pages/api/webhooks/whatsapp.ts](src/pages/api/webhooks/whatsapp.ts), which returns 200 and throws the reply away. Today, nobody can see what was sent or reply to anyone without opening Supabase's table editor.

Goal: a page you can bookmark, styled like WhatsApp Web, that works on desktop and phone, sits behind the same Google sign-in as /admin, and lets you:
- see every message sent, grouped into one conversation per customer;
- read replies;
- answer customers who wrote in the last 24 hours.

Decisions already made:
- **All WhatsApp data stays in Supabase.** It is not copied into Neon.
- **Its own page at `/admin/whatsapp`.** It also gets a link in the admin nav.
- **Data loads once, when the page opens.** It loads again after you send a message and when you press Refresh or pull to refresh. Nothing polls, which matches the saved "admin: no polling" rule.

## 1. Supabase schema: `whatsapp/supabase/migrations/0003_inbox.sql`
These changes only add things. The `shopify-webhook` and `wa-retry` functions keep working without any change.
- **`messages_out`:** add `phone_number_id text`, `source text default 'order'` (`order` | `site` | `inbox`), `kind text default 'template'` (`template` | `text`), `body text` (the free-text reply), `sent_by text` (the founder's email). Add an index on `(to_phone, created_at desc)` and a plain (not unique) index on `meta_message_id`. A unique index could make the Supabase service's own insert fail.
- **New `message_status`:** `meta_message_id pk`, `recipient_phone`, `phone_number_id`, `delivered_at`, `read_at`, `failed_at`, `failed_reason`, `updated_at`. Delivery receipts land here, so a receipt that arrives before its `messages_out` row is never lost and never collides with the service's insert.
- **New `messages_in`:** `meta_message_id text unique`, `from_phone`, `phone_number_id`, `kind` (`text` | `image` | `audio` | `video` | `document` | `sticker` | `location` | `reaction` | `button` | `unsupported`), `body` (text, caption or button text), `media_id`, `media_mime`, `reply_to` (the wamid it quotes), `received_at`, `raw jsonb`. Add an index on `(from_phone, received_at desc)`.
- **New `wa_contacts`:** `phone pk`, `profile_name` (the name from the customer's WhatsApp profile, taken from the webhook), `last_read_at` (shared "seen" marker for the founders), `updated_at`.
- **View `wa_threads`** (`security_invoker = true`): a union of out and in rows grouped by phone. It returns `last_at`, the last message preview and direction, `last_inbound_at`, `unread` (inbound messages after `last_read_at`), `reply_number_id` (the number the customer last wrote to), and the profile name.
- **View `wa_messages`:** the out and in rows as one stream for a single conversation.
- **Access:** RLS is on with no policies. Grants go to `service_role` only, following the README's "new API keys" gotcha, and the migration ends with `notify pgrst, 'reload schema'`.

Phone format everywhere: digits only, with the country code (for example `919876543210`). This is what `normalizePhone` in `_shared/shopify.ts` and `waNumber` in [src/lib/whatsapp.ts](src/lib/whatsapp.ts) already produce, and it matches Meta's `from` field.

## 2. Server helpers
**New [src/lib/whatsapp-store.ts](src/lib/whatsapp-store.ts)**: a small PostgREST client using `fetch`, with no new dependency.
- It reads env vars `WA_SUPABASE_URL` and `WA_SUPABASE_SERVICE_KEY` (server-only), added to [src/env.d.ts](src/env.d.ts) and `.env.example`.
- Functions: `listThreads({ q, filter, before })`, `threadMessages(phone, before)`, `markRead(phone)`, `insertOut(row)`, `upsertInbound(rows)`, `upsertStatuses(rows)`, `upsertContacts(rows)`.
- Like [src/lib/db.ts](src/lib/db.ts), it never throws. It returns null when the store isn't set up.

**New [src/lib/whatsapp-inbox.ts](src/lib/whatsapp-inbox.ts)**: pure functions, so they can be tested.
- `parseWebhook(body)` turns a Meta webhook body into `{ inbound[], statuses[], contacts[] }`.
- `renderTemplate(name, params)` shows a sent template as the customer saw it. It uses a `TEMPLATE_TEXT` map copied from `whatsapp/templates/TEMPLATES.md` plus `cart_reminder` from [src/pages/api/admin/wa-setup.ts](src/pages/api/admin/wa-setup.ts). It falls back to `"Template: name · p1, p2"`.
- `templateParams(request)` reads the `{{n}}` values from the `messages_out.request` JSON.
- `windowOpen(lastInboundAt, now)` checks the 24-hour reply window.

**[src/lib/whatsapp.ts](src/lib/whatsapp.ts)**:
- `sendTemplate` also logs to `messages_out` with `source='site'`, in a best-effort way, using the wamid from Meta's response. It still never throws, and its return type doesn't change.
- New `sendText(to, text, phoneNumberId)` returns `{ ok, messageId, error }`. Meta allows free text only inside the 24-hour window.

## 3. Webhook: [src/pages/api/webhooks/whatsapp.ts](src/pages/api/webhooks/whatsapp.ts)
- POST checks `X-Hub-Signature-256` (an HMAC-SHA256 of the raw body) against a new env var `WHATSAPP_APP_SECRET`. The check fails closed: a bad signature gets a 401, and with no secret set nothing is stored.
- It then runs `parseWebhook` and writes the results to Supabase:
  - inbound messages go in with `on conflict do nothing`, because Meta retries;
  - contact names are upserted;
  - delivered/read/failed timestamps are upserted into `message_status`.
- Delivery receipts give every sent message ✓/✓✓/blue ticks, including the ones the Supabase service sent.
- It always returns 200 after verifying, and the GET handshake stays the same.

## 4. Inbox API: [src/pages/api/admin/whatsapp.ts](src/pages/api/admin/whatsapp.ts)
Gated by `requestIsAdmin` from [src/lib/adminAuth.ts](src/lib/adminAuth.ts), so only the full role gets in. It uses the same `json()` / no-store / noindex headers as [src/pages/api/admin/inbox.ts](src/pages/api/admin/inbox.ts).
- `GET ?view=threads&q=&filter=all|replied|unread&before=` returns the conversation list.
  - Each conversation's name comes from, in order: the WhatsApp profile name, then the Neon `people.name` matched on the last 10 digits (one batched `q()` query using `personIdFor`-style keys, which also gives `person_id` for an "Open in People" link), then the first name from the template's `{{1}}`.
- `GET ?view=thread&phone=&before=` returns up to 100 messages, oldest first, plus `window_open`, `window_closes_at` and `reply_number_id`. It also marks the conversation read.
- `POST { phone, text }`:
  1. checks the 24-hour window again on the server;
  2. sends with `sendText` from `reply_number_id`, so the reply comes from the number the customer wrote to;
  3. falls back to `WHATSAPP_PHONE_NUMBER_ID` if there's no reply number;
  4. saves the row (`source='inbox'`, `sent_by` = the signed-in email) and returns it.
- `GET ?view=media&id=` fetches a photo or voice note through the Graph API with the token and streams it back with `private, max-age=3600`. The page loads it with `fetch` plus the ID token, then shows it from a blob URL.

## 5. Page: `/admin/whatsapp`
- **[src/pages/admin/whatsapp.astro](src/pages/admin/whatsapp.astro)** uses the same `BaseLayout`, no-store and noindex headers as [src/pages/admin/index.astro](src/pages/admin/index.astro). It also adds `apple-mobile-web-app-capable` and `theme-color` so it can be added to a phone's home screen.
- **[src/components/admin/whatsapp/WaInbox.astro](src/components/admin/whatsapp/WaInbox.astro)** holds the markup and **`wa.css`** the styles, in the Mir Kash admin palette from [admin.css](src/components/admin/admin.css) with WhatsApp's layout.
- **Sign-in:** the same Google gate as `AdminShell`, using `getIdToken`, `signInWithGoogle` and `getSessionUser` from `~/lib/firebaseClient`.
- **Desktop (≥ 900px):** two panes.
  - The left pane has search, filter chips (All / Replied / Unread), and conversation rows showing name, phone, preview, time and an unread badge.
  - The right pane is the chat:
    - header with name, phone, "Open in People" and a Refresh button;
    - bubbles with ours on the right and theirs on the left;
    - date separators in IST;
    - a "Template · order_shipped" chip on template messages;
    - tick states;
    - a red "Not delivered" line with the reason when a send failed.
- **Phone:** one pane at a time. Tapping a row opens the chat full screen. The back button uses `history.pushState`, so the phone's own back gesture works. You can pull down on the list to refresh. The composer stays above the keyboard (`100dvh`, safe-area padding).
- **Composer:** Enter sends on desktop, and Shift+Enter starts a new line. While a message is sending it shows a clock, then a ✓ when Meta accepts it. When the 24-hour window is closed, the composer is disabled and says *"Last message from them was 3 days ago. WhatsApp only allows approved templates after 24 hours."*
- **Client module [src/components/admin/whatsapp/wa.ts](src/components/admin/whatsapp/wa.ts):** reuses `esc` from [format.ts](src/components/admin/format.ts) and `istWhen` from [mapping.ts](src/components/admin/mapping.ts). Data loads when the page opens, when you open a conversation, after you send, and when you press Refresh. Nothing polls.
- **Nav link:** add "WhatsApp" under Operations in [AdminShell.astro](src/components/admin/AdminShell.astro), linking to `/admin/whatsapp`.

## 6. Tests
[src/lib/whatsapp-inbox.test.mjs](src/lib/whatsapp-inbox.test.mjs), in the same style as `leadscore.test.mjs` (`node src/lib/whatsapp-inbox.test.mjs`). It covers:
- `parseWebhook` on real-shaped Meta payloads: text, image with caption, button reply, statuses (including failed with an error), and a contacts name;
- `renderTemplate` with all 6 templates and an unknown one;
- `templateParams` on a stored `messages_out.request`;
- `windowOpen` at the 24-hour edge;
- checking the webhook signature against a known HMAC.

## Setup you'll need to do (I'll list it again after building)
1. Run `0003_inbox.sql` in the Supabase SQL Editor.
2. In Vercel, set:
   - `WA_SUPABASE_URL=https://btupzwyyqdkzfoygfwcz.supabase.co`
   - `WA_SUPABASE_SERVICE_KEY` (the legacy `service_role` key)
   - `WHATSAPP_APP_SECRET` (Meta app → Settings → Basic → App secret)
3. In the Meta app's WhatsApp → Configuration, check that the callback URL is `https://<site>/api/webhooks/whatsapp` and that the **messages** field is subscribed.
4. **Check the phone numbers.** The Supabase seed sends from number ID `1162880016911789`, but the site uses `1285100258018493`.
   - If the order messages really come from a different number, that number must be in the same Meta app, so its replies reach this webhook.
   - `WHATSAPP_TOKEN` must have access to both numbers.
   - The inbox replies from whichever number the customer wrote to.

## Limits to know
- Replies that arrived before this ships are gone, because the old webhook discarded them. Everything sent before now still shows, since it's already in `messages_out`.
- Outside the 24-hour window you can only read. Sending templates from the inbox can be added later.

## Verification
1. `node src/lib/whatsapp-inbox.test.mjs` passes.
2. Run `npm run dev` with the env vars set:
   - Sign in at `/admin/whatsapp`. The existing `messages_out` history shows as conversations, with rendered template text.
   - Send a signed sample webhook body to `/api/webhooks/whatsapp` with `curl`. The reply appears after Refresh. An unsigned body gets a 401.
3. Send a WhatsApp message from your own phone to the business number. It shows up, and the reply box is enabled.
   - Reply from the inbox. It arrives on your phone, and after Refresh its ticks move to delivered and then read.
4. Check the layout in Chrome at phone width (390px) and on desktop: list → chat → back, the keyboard doesn't cover the composer, and nothing scrolls sideways.
5. `npm run build` passes.
