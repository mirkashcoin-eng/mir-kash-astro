# WhatsApp inbox: tickets

Design: [../plan.md](../plan.md). Branch: `whatsapp-inbox`.

All tickets build against one shared contract, **[src/lib/whatsapp-types.ts](../../../src/lib/whatsapp-types.ts)**. That commit also adds placeholder stubs (correct signatures, empty bodies) for:
- `src/lib/whatsapp-store.ts`
- `src/lib/whatsapp-inbox.ts`
- `sendText` in `src/lib/whatsapp.ts`

So every ticket compiles on its own, and WA-1 to WA-5 can run **in parallel**. Each ticket owns a fixed set of files. Don't edit a file owned by another ticket. If the contract seems wrong, say so in your summary; don't change it.

| Ticket | What | Owns | Depends on (contract only) |
|---|---|---|---|
| [WA-1](WA-1-supabase-store.md) | Supabase migration and PostgREST store | `whatsapp/supabase/migrations/0003_inbox.sql`, `src/lib/whatsapp-store.ts`, `whatsapp/README.md` (new section) | — |
| [WA-2](WA-2-pure-helpers.md) | Pure helpers and tests | `src/lib/whatsapp-inbox.ts`, `src/lib/whatsapp-inbox.test.mjs` | — |
| [WA-3](WA-3-webhook-and-sending.md) | Meta webhook (signed, stores replies and receipts), send logging, `sendText` | `src/pages/api/webhooks/whatsapp.ts`, `src/lib/whatsapp.ts`, `src/env.d.ts`, `.env.example` | WA-1 and WA-2 signatures |
| [WA-4](WA-4-admin-api.md) | `/api/admin/whatsapp`: threads, thread, send, media | `src/pages/api/admin/whatsapp.ts` | WA-1, WA-2, WA-3 signatures |
| [WA-5](WA-5-inbox-page.md) | `/admin/whatsapp` page in WhatsApp Web style, for desktop and phone, with demo mode | `src/pages/admin/whatsapp.astro`, `src/components/admin/whatsapp/*`, one nav link in `src/components/admin/AdminShell.astro` | API response types only |
| [WA-6](WA-6-integration.md) | Merge, end-to-end check, setup checklist | — | WA-1 to WA-5 |

## Rules for every ticket
- Match the surrounding code: its comment density, naming, the `env()` helper pattern, the `json()` response helper, and never throwing in I/O helpers.
- **No polling and no realtime.** Data loads when the page opens, when a conversation is opened, after a send, and on Refresh.
- No new npm dependencies.
- `npx tsc --noEmit -p .` must show **no new errors**. The baseline is 7 errors, all in `src/catalog-tool/`.
- The keys aren't set up yet (`WA_SUPABASE_*`, `WHATSAPP_APP_SECRET`). Without them, everything must quietly do nothing: no crash, no 500, nothing logged as an error on every request.
- Commit your work on your worktree branch with a clear message. End the message with
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
