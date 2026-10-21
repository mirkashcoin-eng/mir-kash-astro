# WA-4: `/api/admin/whatsapp`

**Owns:** `src/pages/api/admin/whatsapp.ts` (new).
**Uses** (signatures from the stubs; other tickets implement them):
- from `~/lib/whatsapp-store` (WA-1): `waStoreConfigured`, `listThreadRows`, `listMessageRows`, `lastInbound`, `markRead`, `insertOut`;
- from `~/lib/whatsapp-inbox` (WA-2): `previewOf`, `renderTemplate`, `templateParams`, `tickFor`, `windowOpen`, `windowClosesAt`;
- from `~/lib/whatsapp` (WA-3): `sendText`, `waNumber`;
- the response types in `~/lib/whatsapp-types` (`WaThreadsResponse`, `WaThreadResponse`, `WaSendResponse`, `WaThread`, `WaMessage`). These are the page's contract, so return exactly these shapes.

Follow the style of `src/pages/api/admin/inbox.ts`: `prerender = false`, a header comment describing GET and POST, the same `json()` helper and headers (`private, no-store`, `noindex`), and `requestIsAdmin` from `~/lib/adminAuth` (full role only) on **every** method, with a 401 `{ error: 'Not authorised' }` otherwise.

## GET `?view=threads&q=&filter=all|replied|unread&before=`
- If `!waStoreConfigured()`, return `{ configured:false, as_of, threads:[], next_before:null }` with status 200.
- Call `listThreadRows({ q, filter, before, limit: 50 })`. If it returns null, respond 502 `{ error: "Couldn't load conversations" }`.
- **Names.** For each phone, the name is the first of these that exists:
  1. `profile_name`;
  2. the Neon `people` name, found with one batched query, `q('SELECT person_id, name FROM people WHERE person_id = ANY($1)', [keys])` from `~/lib/db`, where `keys = rows.map(r => personKey(r.phone))` and `personKey` comes from `~/lib/events`. This also gives `person_id` for any key that matched. Skip the step quietly if Neon is unavailable (`q` returns null);
  3. the first name in `templateParams(last_request)[0]`, used only when `last_direction === 'out'` and the value isn't `'there'`;
  4. null.
- `last_preview = previewOf(last_kind, last_body, last_template, last_request)`, with the prefix `"You: "` when `last_direction === 'out'` and the kind isn't `template`.
- `window_open = windowOpen(last_inbound_at)`.
- `next_before` is the last row's `last_at` when the page came back full, otherwise null.

## GET `?view=thread&phone=&before=`
- Normalise `phone` with `waNumber`. Fewer than 11 digits gives 400.
- Run `listMessageRows(phone, { before, limit: 100 })`, `lastInbound(phone)`, and the same name and person lookup for this one phone (thread row via `listThreadRows({ q: phone, limit: 1 })` for `profile_name`, or reuse the logic; keep it to a few calls) in parallel.
- Map each row to a `WaMessage`:

  | Field | Value |
  |---|---|
  | `text` | for a `template`: `renderTemplate(template_name, templateParams(request))`; otherwise `body` |
  | `tick` | for `out`: `tickFor(row)`; for `in`: null |
  | `failed_reason` | `failed_reason`, or else the error message from `send_error` (`send_error.error.message` / `error_data.details`) |

  Reverse the list so it's oldest first.
- `window_open` and `window_closes_at` come from `lastInbound`.
- `next_before` is the oldest row's `at` when the page came back full.
- Call `markRead(phone)` only when there's no `before`, i.e. on the first page. Await it, but ignore the result.

## POST `{ phone, text }` (JSON)
- Validate both fields. The phone goes through `waNumber`. The text is trimmed and must be 1 to 4096 characters.
- Get the founder's email for `sent_by` by verifying the bearer token with `verifyFirebaseUser` from `~/lib/firebaseAuth`, as inbox.ts does for `done_by`.
- Look up `lastInbound(phone)`. If the window is closed, return 409 `{ ok:false, error: 'More than 24 hours since they last wrote. WhatsApp only allows an approved template now.' }`.
- Call `sendText(phone, text, last.phone_number_id)`. Then always call `insertOut` (status sent or failed, `source:'inbox'`, `kind:'text'`, `body:text`, `sent_by`, `template_name:null`, and the request and response from `sendText`).
- On success, return `{ ok:true, message }` with `tick 'sent'`. On failure, return 502 `{ ok:false, error }`.

## GET `?view=media&id=`
- The `id` must match `/^\d+$/`.
- `GET https://graph.facebook.com/v21.0/<id>` with `Bearer WHATSAPP_TOKEN` gives `{ url, mime_type }`. Then fetch that `url` with the same bearer, and stream the body back with `Content-Type: mime_type` and `Cache-Control: private, max-age=3600`.
- Use 10s timeouts. A Meta error or expired media gives 404 `{ error: 'Media no longer available' }`.

## Acceptance
- `tsc` shows no new errors.
- Every branch checks admin before doing anything else.
- No route throws on a failure from the store, Neon or Meta: each one returns JSON with a plain error.
- In your summary, give a short example of each response, based on the stub shapes.
