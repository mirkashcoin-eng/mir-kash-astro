# WA-6: Integration (done by the lead after WA-1 to WA-5)

1. Merge each worktree branch into `whatsapp-inbox`, and resolve any overlap with the contract.
2. Run `npx tsc --noEmit -p .`, which should show only the 7 errors from the baseline, then `node src/lib/whatsapp-inbox.test.mjs`, then `npm run build`.
3. **Cross-ticket review:**
   - Do the view columns from WA-1 match `WaMessageRow` and `WaThreadRow`, and does WA-4 use them correctly?
   - Is the webhook from WA-3 idempotent, and does it fail closed?
   - Does WA-4 check admin on every branch?
   - Does WA-5 escape all user text?
4. **With no setup done**, use `npm run dev`:
   - `/admin/whatsapp?demo=1` works on desktop and phone widths.
   - A signed-in `/admin/whatsapp` shows "not connected yet".
   - A `POST /api/webhooks/whatsapp` gets 200 and stores nothing.
   - The `/admin` nav links to the inbox.
5. **After the owner's setup** (the checklist is in `../plan.md` under "Setup you'll need to do"):
   - existing history shows up;
   - a WhatsApp message sent from the owner's phone appears;
   - a reply sent from the inbox arrives;
   - its ticks move to read.
