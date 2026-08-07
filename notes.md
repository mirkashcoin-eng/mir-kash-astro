# Notes

Open items that live outside the codebase — things to change in Google Analytics,
Google Ads, Shopify or Vercel. Nothing here is fixed by editing this repo.

## Pending

### GA4 custom dimensions not registered
Every GA4 hit is tagged with `market` (india | global) and `country`, but GA4
drops unregistered custom parameters from its reports — the data is being sent
and silently ignored.

**Fix:** GA4 Admin → Custom definitions → Create custom dimension, twice:

| Dimension name | Scope | Event parameter |
| --- | --- | --- |
| Market | Event | `market` |
| Country | Event | `country` |

Property: `mirkash.com NEW` (`G-FZN0YD1X1R`). Data only appears from the moment
they're registered — it is not backfilled, so the sooner the better.

### Duplicate Google Ads conversion actions
The account had four Primary "Purchase" conversion actions before `Purchase (1)`
(label `0yRaCMK76NwcEKiz-bVD`, ID `18098313640`) was added. Multiple Primary
actions firing on the same purchase double-count conversions, which inflates
reported ROAS and misleads Smart Bidding — it optimises toward a number that
isn't real.

**Fix:** Google Ads → Goals → Conversions. Keep one Primary purchase action;
set the rest to **Secondary** (they keep reporting but stop feeding bidding).
Demote rather than delete, so historical data survives.

## Done

- GA4 installed (`G-FZN0YD1X1R`) — was never on the site; only the Ads pixel and
  Clarity were present.
- Google Ads purchase conversion wired for both India and global checkouts.
- Microsoft Clarity (`xt4v3tq3mp`) via the official Shopify app — the manual
  snippet can't work in Shopify's sandboxed checkout pixel.
- Backfill endpoint removed after recovering ~2 months of phone data
  (27 legacy docs → 13 people).

## Watch after the next deploy

Today's tracking is verified locally but has never written to production
Firestore (Vercel won't export the service-account secret to a local shell).
Worth confirming once live:

- Viewing a product page adds to `viewed` on that person's record.
- The Daily funnel's "Viewed 1 / 2 / 2+ products" rows start filling. They stay
  empty until this deploys — that tracking didn't exist before.
- The Crawlers panel lists ChatGPT / Perplexity / Googlebot within a day or two.

If `viewed` stays empty after browsing a product page, that's the piece with the
most new moving parts — start there.

## Security

- **Rotate `ADMIN_PASSCODE`.** The current value was shared in a chat session and
  used in shell commands, so it should be treated as compromised. Vercel →
  Settings → Environment Variables → redeploy.
- Better: set `ADMIN_EMAILS` and use Google sign-in (already supported), so there
  is no shared secret and logins are attributable.

## Known gaps

- **Global market has no affiliate attribution.** Those orders check out on
  Shopify's hosted checkout, where our cookies and tags can't reach. Closing it
  needs `attributes` on the Storefront `cartCreate` / `cartLinesAdd` calls.
- **Shopify's `customerJourneySummary` is not used** — deliberately. India is
  headless (Astro + Cashfree), so Shopify never sees the browsing session and its
  attribution would be empty or misleading. Our own capture is the source of truth.
- **Bot counts start from the deploy of the crawler work.** Rows created earlier
  have no `bot` field and are counted as human.
