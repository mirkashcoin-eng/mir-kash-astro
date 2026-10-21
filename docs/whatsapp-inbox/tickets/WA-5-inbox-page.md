# WA-5: `/admin/whatsapp` page

**Owns:**
- `src/pages/admin/whatsapp.astro` (new)
- `src/components/admin/whatsapp/WaInbox.astro`, `wa.css`, `wa.ts`, `fixtures.ts` (new)
- **one** nav link added to `src/components/admin/AdminShell.astro`

**Contract:** the response shapes in `src/lib/whatsapp-types.ts` (`WaThreadsResponse`, `WaThreadResponse`, `WaSendRequest`, `WaSendResponse`, `WaThread`, `WaMessage`, `WaFilter`). The API (WA-4) is built in parallel, so code against these types alone.

## Look and feel
Use WhatsApp Web's *layout* in Mir Kash's *look*.
- Read `src/components/admin/admin.css` and `AdminShell.astro` and reuse its tokens (fonts, colours, radius, the calm style from the latest commit). Don't copy WhatsApp's green branding.
- Outgoing bubbles use a warm tint of the admin accent. Incoming bubbles use the surface colour.
- Ticks:
  - ✓ grey for sent;
  - ✓✓ grey for delivered;
  - ✓✓ in the accent colour for read;
  - a red "Not delivered: <reason>" line under the bubble for failed.
- Template messages show a small "Template · order_shipped" chip above the text, and their text keeps its line breaks (`white-space: pre-wrap`).
- Date separators: "Today", "Yesterday", otherwise "Mon 12 Oct" in IST. Times look like "3:42 pm" in IST. Use the helpers in `src/components/admin/format.ts` and `mapping.ts` where they fit.
- Escape all user text with `esc()` from `format.ts`. Turn links in text into anchors only after escaping, with `rel="noopener noreferrer" target="_blank"`.

## Page and auth
- **`src/pages/admin/whatsapp.astro`:** follow `src/pages/admin/index.astro`: `BaseLayout` with `path="/admin/whatsapp"`, the `private, no-store` and noindex headers, `prerender = false`. In the head, also add `<meta name="apple-mobile-web-app-capable" content="yes">`, `theme-color` and a `viewport-fit=cover` viewport if BaseLayout allows it. If it doesn't, leave those out rather than editing BaseLayout.
- **Sign-in:** reuse the gate markup and behaviour from `AdminShell.astro` and `main.ts`:
  - `getSessionUser`, `signInWithGoogle` and `getIdToken` from `~/lib/firebaseClient`;
  - show the inbox when the API returns anything except 401;
  - on 401, show "This account doesn't have access" with a sign-out button.

  Read `src/components/admin/main.ts` for how it's done.
- **All API calls** go to `/api/admin/whatsapp` with `Authorization: Bearer <idToken>`.

## Desktop layout (≥ 900px): two panes, filling `100dvh`
- **Left pane (360px):**
  - header with the title "WhatsApp", a Refresh button, and a link back to `/admin`;
  - a search box (debounced to 300ms; searching hits the API with `q`);
  - filter chips: All, Replied, Unread;
  - the conversation list. Each row shows an initials avatar, the name (or a formatted phone, "+91 98765 43210"), the time of the last message, a one-line `last_preview`, an unread badge, and a small dot when `window_open` (title "Can reply").
  - Load more by sending `next_before` when the user scrolls to the bottom.
- **Right pane:**
  - **Header:** name, phone, and "Open in People" (a link to `/admin#people?id=<person_id>` when there's a person), plus Refresh.
  - **Messages:** scroll to the bottom when the conversation opens, and show a "Load earlier" button at the top when there's a `next_before`.
  - **Composer:** an auto-growing textarea and a Send button. Enter sends and Shift+Enter starts a new line on desktop. On touch devices Enter starts a new line.
  - **When the window is closed:** disable the composer and show a note: *"They last wrote {relative time}, or never. WhatsApp only allows approved templates after 24 hours."*
  - **Sending:**
    1. add the bubble straight away with a 🕓 clock;
    2. on `ok`, swap in the returned message;
    3. on error, show a red line under the bubble with the error and a Retry action.

    Don't re-fetch the whole thread after a send.
  - **Empty state** (no conversation selected): a quiet message, "Choose a conversation".
- **Media:** for an `image` or `sticker` with a `media_id`, show a placeholder. When it scrolls into view (IntersectionObserver), `fetch` `?view=media&id=` with the bearer token, turn it into a blob URL, and show the `<img>`. Clicking it opens the full image in a new tab. For audio, use an `<audio controls>` loaded the same way. Other kinds show their preview text.

## Phone layout (< 900px)
- One pane at a time. Tapping a row opens the chat full screen, with a back arrow in the header.
- Use `history.pushState`/`popstate` so the phone's back gesture goes back to the list. Keep the open phone in the URL hash, `#c=919876543210`, so a refresh reopens that conversation.
- Pull down at the top of the list to refresh. A simple touch handler is enough; if that's fiddly, a visible Refresh button is fine.
- The composer stays above the keyboard: `100dvh` layout, a sticky footer, and `env(safe-area-inset-bottom)` padding. No horizontal scrolling at 360px. Tap targets are at least 44px.

## Data loading: no polling
Load when the page opens, when a conversation is opened, after a send, on Refresh, and when going back to the list (reuse the loaded list; refetch only on Refresh). There's no timer, no focus or visibility refetch, and no realtime.

## States
- **`configured:false`:** a calm panel: "WhatsApp inbox isn't connected yet. Add WA_SUPABASE_URL and WA_SUPABASE_SERVICE_KEY in Vercel, then run whatsapp/supabase/migrations/0003_inbox.sql. Messages will appear here after that."
- **Loading:** skeleton rows.
- **Errors:** inline text with Retry. No `alert()`, `confirm()` or `prompt()`.

## Demo mode, for reviewing the design before setup
Follow the existing pattern in `src/components/admin/data.ts` (`DEMO`, `DEMO_SKIPS_AUTH`): `?demo=1` on the **dev server** (`import.meta.env.DEV`) skips sign-in and uses `fixtures.ts`.
- **What the fixtures contain:** 12 or more realistic Indian-customer threads, with names, +91 numbers, and the real template texts:
  - order confirmed then shipped;
  - a COD confirmation with a "YES" reply (window open);
  - a reply with a photo;
  - a failed send;
  - an unread reply;
  - a thread with an old reply (window closed);
  - cart-reminder-only threads with no reply;
  - one long thread of 40 or more messages, to test scrolling and "Load earlier".
- **How it behaves:** sending in demo mode adds the bubble and fakes `ok` after 600ms. Media in demo mode uses a small inline SVG placeholder.
- Label the page "Sample data" so nobody mistakes it for real data.
- The fixtures must be built in the contract's types, so demo mode runs the same rendering code as real mode.

## Nav link
In `AdminShell.astro`, add `<a class="ad-nav__item" href="/admin/whatsapp">WhatsApp</a>` under Operations, after "Private Viewing". It's a normal link to the other page and is **not** part of the hash router, so check that `main.ts`'s nav handling doesn't intercept a link without `data-nav`. If it does, mention it in your summary rather than editing `main.ts`.

## Acceptance
- `tsc` shows no new errors, and `npm run build` succeeds.
- Run `npm run dev`, open `/admin/whatsapp?demo=1` in Chrome, and check:
  - at a width of 1280px: the two panes, opening a thread, sending, "Load earlier", filters, search on fixtures (filter in memory in demo mode), and a failed bubble;
  - at a width of 390px: list → chat → back with the browser's back button, the composer at the bottom, and no horizontal scroll.

  Take screenshots and describe what you checked in your summary. If the browser tools aren't available, say so.
