# WA-2: Pure helpers and tests

**Owns:** `src/lib/whatsapp-inbox.ts`, `src/lib/whatsapp-inbox.test.mjs`.
**Contract:** `src/lib/whatsapp-types.ts`. Keep every exported signature in the stub exactly as it is.

No I/O and no imports beyond the types. The file must run under Node (the test imports the `.ts` directly, as `src/lib/leadscore.test.mjs` does) and in Vercel functions. Use `globalThis.crypto.subtle` for the HMAC and nothing from `node:crypto`.

## Functions
- **`TEMPLATE_TEXT`**: the exact body text of each template, with `{{n}}` left in.
  - Take `order_confirmed`, `cod_confirmation`, `order_shipped`, `order_cancelled` and `refund_processed` from `whatsapp/templates/TEMPLATES.md`.
  - Take `cart_reminder` from `src/pages/api/admin/wa-setup.ts`.
  - The site's `order_confirmed` in `wa-setup.ts` has different wording from TEMPLATES.md. Use the TEMPLATES.md version, because the Supabase service sends most of the messages, and say so in a comment.
  - Also add `hello_world` with text "Hello World".
- **`parseWebhook(body)`**: Meta's shape is `{ object, entry: [{ changes: [{ field: 'messages', value: { metadata: { phone_number_id }, contacts?, messages?, statuses? } }] }] }`. Handle multiple entries and changes. Skip any change whose `field` isn't `messages`.
  - **messages** become `WaInboundRow`:
    - the phone comes from `from`, digits only;
    - `received_at` is the unix `timestamp` × 1000 as an ISO string;
    - `reply_to` is `context.id`;
    - `raw` is the message object.
  - **Mapping from Meta's `type`:**

    | Meta type | Our kind | body | media |
    |---|---|---|---|
    | `text` | `text` | `text.body` | — |
    | `image`, `video`, `audio`, `document`, `sticker` | same name | `caption`, or `filename` for documents | `id` and `mime_type` |
    | `voice` (some API versions) | `audio` | — | `id` and `mime_type` |
    | `button` | `button` | `button.text` | — |
    | `interactive` | `button` | `button_reply.title` or `list_reply.title` | — |
    | `reaction` | `reaction` | `reaction.emoji` | — |
    | `location` | `location` | `name` or `address`, else `"lat,lng"` | — |
    | anything else | `unsupported` | — | — |

  - **statuses** become `WaStatusRow`: `id` → `meta_message_id`, `recipient_id` → `recipient_phone`, `status` (keep only sent, delivered, read or failed), `timestamp` → ISO, and `error` = `errors[0].error_data.details || errors[0].message || errors[0].title || null`.
  - **contacts** become `WaContactRow`: `wa_id` and `profile.name`.
  - Never throws. Anything malformed is skipped.
- **`verifySignature(raw, header, secret)`**: the header looks like `sha256=<hex>`. Compute HMAC-SHA256 of `raw` as UTF-8 with the secret and compare in constant time. Return false if the header or secret is missing, the prefix is wrong, or the length differs.
- **`templateParams(request)`**: from `request.template.components[]`, take the component whose `type` is `body` (case-insensitive) and map its `parameters[].text` to strings. Return `[]` if it's missing.
- **`renderTemplate(name, params)`**: fill each `{{n}}` with `params[n-1]`, and leave it untouched if that's missing. An unknown or null name gives `"Template: <name> · p1, p2"`, without the dot part when there are no params, and an empty name gives `"Template message"`.
- **`windowOpen` / `windowClosesAt`**: the window is open when `lastInboundAt` exists and `now - lastInboundAt < WINDOW_MS`. `windowClosesAt` returns `lastInboundAt + 24h` as an ISO string, or null.
- **`tickFor`**: if `send_status === 'failed'` or `failed_at` is set, the tick is `failed`. Otherwise it's `read` when `read_at` is set, else `delivered` when `delivered_at` is set, else `sent`.
- **`previewOf(kind, body, template, request)`**:
  - template: `renderTemplate(template, templateParams(request))`;
  - text and button: the body;
  - image: `📷 Photo` (`📷 <caption>` when there's a caption), and likewise video `🎥`, audio `🎤 Voice message`, document `📄 <filename or Document>`, sticker `Sticker`, location `📍 Location`, reaction `Reacted <emoji>`, unsupported `Unsupported message`.
  - Collapse whitespace and newlines to single spaces and cut at 120 characters with `…`.

## Tests: `src/lib/whatsapp-inbox.test.mjs`
Follow `src/lib/leadscore.test.mjs`: a header comment with the run command, `node:assert/strict`, and a final `console.log('ok …')`. Cover:
- a realistic multi-entry Meta payload with text, image with caption, button, interactive list reply, reaction, an unknown type, contacts, and statuses (one of them failed, with an error);
- a malformed body (`null`, `{}`, `entry: 'x'`), which must return empty lists;
- `verifySignature` with a known vector (compute the expected hex with `node:crypto` *inside the test only*), plus a wrong secret, a missing prefix and a null header;
- `templateParams` and `renderTemplate` for all 6 templates, an unknown name and a missing param;
- `windowOpen` at 23h59m and 24h01m;
- the `tickFor` precedence order;
- `previewOf` truncation and each kind.

## Acceptance
- `node src/lib/whatsapp-inbox.test.mjs` passes.
- `tsc` shows no new errors.
