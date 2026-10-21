# WA-3: Meta webhook, send logging, `sendText`

**Owns:** `src/pages/api/webhooks/whatsapp.ts`, `src/lib/whatsapp.ts`, `src/env.d.ts`, `.env.example`.
**Uses** (signatures from the stubs; other tickets implement them):
- from `~/lib/whatsapp-store` (WA-1): `waStoreConfigured`, `insertOut`, `upsertInbound`, `upsertStatuses`, `upsertContacts`;
- from `~/lib/whatsapp-inbox` (WA-2): `parseWebhook`, `verifySignature`.

Don't edit those two files.

## 1. Webhook POST: `src/pages/api/webhooks/whatsapp.ts`
Leave the GET verification handshake exactly as it is. Update the file's header comment.

**Order of work:**
1. Read the raw body with `await request.text()`.
2. Check the signature:
   - **If `WHATSAPP_APP_SECRET` isn't set:** return 200 `ok` and store nothing. Log it with `console.warn` at most once per instance, using a module-level flag. Meta keeps retrying on any non-200 response, and we would rather drop the data than store unverified data.
   - **If the secret is set and `verifySignature(raw, request.headers.get('x-hub-signature-256'), secret)` is false:** return 401.
3. `JSON.parse` the raw body, then `parseWebhook`. Invalid JSON gets 200 (logged), because Meta sending it again won't help.
4. If `waStoreConfigured()`, run `Promise.all([upsertContacts, upsertInbound, upsertStatuses])`, each only when its list isn't empty. If any of them returns false, return **500**. Meta then retries, which is safe because every write is idempotent.
5. Return 200 `ok` with `Cache-Control: no-store`.

Keep it fast: no Graph API calls, and no Shopify or Firestore here.

## 2. `src/lib/whatsapp.ts`
- **`sendTemplate`:** after the fetch, parse Meta's JSON body whether the call succeeded or failed. Then call `insertOut` once, best-effort, catching any error and never awaiting in a way that could throw:

  | Field | Value |
  |---|---|
  | `to_phone` | `to` |
  | `template_name` | `template` |
  | `meta_message_id` | `json.messages?.[0]?.id ?? null` |
  | `status` | `'sent'` or `'failed'` |
  | `request` | the body we sent |
  | `response` | Meta's JSON, or `{ error: String(e) }` on a network error |
  | `phone_number_id` | `WHATSAPP_PHONE_NUMBER_ID` |
  | `source` | `'site'` |
  | `kind` | `'template'` |
  | `body` | null |
  | `sent_by` | null |

  The return type (`Promise<boolean>`) and the never-throw behaviour stay the same. Logging must not add noticeable delay. It's one PostgREST call with a 10s cap inside the store, and that's fine because `sendTemplate` is already awaited off the critical path. **Do not** log when `whatsappConfigured()` is false or the number is unusable, since nothing was sent.
- **`sendText(to, text, phoneNumberId?)`:** replace the stub.
  - Normalise the number with `waNumber`. Fewer than 11 digits gives `error: 'No valid WhatsApp number'`.
  - Trim the text. Reject it when it's empty or over 4096 characters.
  - POST `{ messaging_product:'whatsapp', recipient_type:'individual', to, type:'text', text: { body, preview_url: true } }` to `${GRAPH}/${phoneNumberId || WHATSAPP_PHONE_NUMBER_ID}/messages`, with the same 10s abort.
  - Return `{ ok, messageId, phoneNumberId, request, response, error }`. Turn Meta's error into a plain-English message: code `131047` (re-engagement, outside the 24h window) becomes "More than 24 hours since they last wrote. WhatsApp only allows an approved template now." Otherwise use `error.error_data.details || error.message`.
  - It **does not** log to the store itself, because the admin API logs the reply with `sent_by`. Never throws.
- Update the module's header comment to mention the inbox.

## 3. Env
- **`src/env.d.ts`:** add `WA_SUPABASE_URL`, `WA_SUPABASE_SERVICE_KEY` and `WHATSAPP_APP_SECRET`, with one-line comments in the same style as the existing WhatsApp ones. Also add `WHATSAPP_VERIFY_TOKEN` if it's missing.
- **`.env.example`:** add the three new vars to the WhatsApp block. `.env.example` mentions WhatsApp in two places, so look at both. Use placeholder values and mark them as secrets.

## Acceptance
- `tsc` shows no new errors.
- Write a scratch script outside the repo, or test inline with `node --input-type=module`, showing that with no `WHATSAPP_APP_SECRET` set the POST handler returns 200 and calls no store function. Describe the result in your summary. There's no need to commit the script.
- `cron/whatsapp.ts` and `notifyOrderConfirmed` behave exactly as before.
