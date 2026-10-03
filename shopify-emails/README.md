# Shopify notification emails

These are the customer emails that both Shopify stores send: order confirmation, shipping, refunds, returns, accounts and gift cards. They follow the brand guide's colours, type and voice (`brand-wiki/brand-guidelines.md`). Both stores are built from one source, so they can't drift apart.

Shopify has no API for notification templates. You edit the files here, build them, and paste the result into each store's admin.

## Layout

| Path | What it is |
|---|---|
| `src/layout.liquid` | Shell shared by every email: head, fonts, logo header, Cherry Red footer |
| `src/partials/` | Shared blocks: button, product rows, totals, addresses, tracking, callouts |
| `src/templates/` | One file per notification. The frontmatter holds the admin name and the subject line |
| `fixtures/` | Sample order data for the previews (India: COD in INR. Global: card payment in USD. Plus variants) |
| `dist/india/`, `dist/global/` | **Generated.** Paste these. Each file is self-contained |
| `dist/<store>/SUBJECTS.md` | **Generated.** The subject line to paste with each template |
| `preview/` | **Generated, not committed.** Open `preview/index.html` in a browser |

The two stores' outputs differ only in a few constants, set in `STORES` in `scripts/build-shopify-emails.mjs`:
- the return window: 7 days for India, 15 for Global
- the return address: Mumbai for India, Hong Kong for Global
- the delivery promise
- the tax label

India also gets the Cash on Delivery wording.

## Build

```sh
npm run emails
```

The build fails if a template uses an unknown style token, leaves a partial un-inlined, or doesn't render with the sample data.

## Before the first paste

1. **Deploy the site.** The logos are served from `https://www.mirkash.com/email/mir-kash-logo.png` and `mir-kash-logo-parchment.png` (in `public/email/`). Until they're live, the emails show the alt text "Mir Kash" instead.
2. **Settings → Notifications → Customize email templates**, in both stores:
   - Upload `public/email/mir-kash-logo.png` as the logo.
   - Set the accent colour to `#8B1A1A`.

   The templates don't read these settings, but Shopify's order status page and any template you haven't replaced do.
3. **Settings → General → Store details → Sender email**: set the sender name to **Mir Kash** in both stores.
4. **Optional, India:** prices are whole rupees, so you could set the currency format to `₹{{amount_no_decimals}}` (Settings → General → Store currency → Change formatting). Emails would then show ₹15,399 instead of ₹15,399.00.

## Pasting

For each template, in each store:
1. Open Settings → Notifications → Customer notifications.
2. Open the notification named in the store's `dist/<store>/SUBJECTS.md`, then click **Edit code**.
3. Replace the **Email subject** with the subject from `SUBJECTS.md`.
4. Replace the whole **Email body (HTML)** with the contents of the matching `.liquid` file.
5. Click **Preview**, then **Send test email**, then **Save**.

Start with the order confirmation in one store and check the test email before doing the rest. Shopify's **Revert to default** button brings back the original template at any time.

**Paste the India files into the India store and the Global files into the Global store.** The first lines of each file say which store it's for. A Global file in the India store would show the wrong return window and address, and no Cash on Delivery wording.

## Notes by email

- **Order confirmation:** India Cash on Delivery orders (created with `paymentPending=true` in `src/lib/shopify/admin.ts`) have `financial_status == 'pending'`. They get a "Paying on delivery" note with the amount to keep ready, and show "Cash on delivery" as the payment method. "Out for delivery" repeats the note.
- **Abandoned checkout:** this is **Global only**. India's own checkout never creates a Shopify checkout, so this email can't fire there. India cart recovery is the WhatsApp `cart_reminder`.
- **Draft order invoice:** this is for invoices you send by hand. The India checkout completes draft orders through the API and never sends this email.
- **Product images:** these are requested as JPEG over https (`img_url: '240x', format: 'jpg'`, with `//cdn` rewritten to `https://cdn`). The store's product photos are AVIF, which Outlook and some other clients can't display. If a test email shows a broken product image, Shopify ignored the `format` option. Tell Claude and the fallback will change.
- **Fonts:**
  - Apple Mail and iOS Mail show DM Serif Display and Brooklyn.
  - Gmail and Outlook block web fonts and show Georgia for headings and Helvetica or Arial for text.
  - Outlook on Windows also gets square buttons drawn in VML.

## Not replaced (they keep Shopify's default)

These are left alone because the stores don't use them, or because no reliable variable reference exists for them:
- local delivery and local pickup
- POS and exchange receipts
- B2B company welcome
- subscription emails
- the new customer accounts' verification-code email
- the customer email-change confirmation

If you start using one of them, add a template to `src/templates/`.

## Adding or changing an email

1. Edit or add a file in `src/templates/`. Copy a similar one.
   - The frontmatter needs `name` (the Shopify admin name), `section` and `subject`. The optional fields are `stores: global` and `previews: <fixture variant>`.
   - Everything above the `<!-- body -->` line sets `email_title`, `email_preheader` and `mk_eyebrow`.
   - Everything below it is the body.
2. Use `{% render 'partial-name' %}` for the shared blocks. Each partial lists the `mk_*` variables it needs at the top.
3. Use `%%token%%` for inline styles (the `STYLES` list in the build script), so colours and type stay consistent.
4. Run `npm run emails`, check `preview/index.html`, and paste the changed files.
