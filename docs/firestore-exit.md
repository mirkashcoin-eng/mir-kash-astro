# Leaving Firestore (code finished 2026-10-23)

Everything in the app now reads and writes Neon. Firestore is no longer touched by any code path.
Firebase **Auth** (admin sign-in and customer Google sign-in) is not Firestore and stays on.

## What moved

| Was in Firestore | Now in Neon | Where |
|---|---|---|
| `admins` (Team access) | `admins` | `lib/adminRoles.ts` |
| `coupon_redemptions` (India coupon usage) | `coupon_redemptions` | `lib/coupons.ts` |
| `profiles` (customers' saved addresses; browser used the Firestore SDK) | `customer_profiles`, via `GET/PUT /api/account/profile` | `pages/api/account/profile.ts`, `lib/firebaseClient.ts` |
| `affiliates`, `clicks` | `affiliates`, `affiliate_clicks`, `v_affiliates` | `lib/clicks.ts` |
| `newsletter` | `newsletter_signups` | `lib/newsletter.ts` |
| `leads`, `people` (visitor intent) | `events`, `people` (already dual-written) | `/api/lead` is now a no-op |
| `analytics_daily`, `product_stats` counters | `events` + `legacy_daily` | `/api/track` is now a no-op; panels in `lib/warehouse/panels.ts` |
| `funnel_daily` | `v_funnel_daily` + `legacy_daily` | Daily funnel tab |

Deleted: `lib/leads.ts`, `lib/funnel.ts`, `lib/firebaseAdmin.ts`, `/api/admin/journey`, `lib/warehouse/affiliates.ts`.
`firebase-admin` is now a devDependency, used only by the two copy scripts.

## Done on 2026-10-23

- Migration `008_firestore_exit.sql` applied (tables `admins`, `coupon_redemptions`, `customer_profiles`).
- Copied once with `scripts/migrate-firestore-rest.mjs`: 20 affiliates, 324 clicks, 20 newsletter signups, 2 admins, 1 coupon redemption, 28 customer profiles.
- Full Shopify order resync, so `orders.click_id` is filled (only 1 order carries a creator click).
- Leads, people and daily counters were NOT re-copied: the live tracker has dual-written to Neon since the first migration, so there is no gap.

## Order to finish (the deploy must come BEFORE anything is switched off)

1. Deploy this code (push `main`). Until then the live site still reads and writes Firestore and the old data is intact.
2. Check on the live site: /admin loads (Team, Affiliates, Newsletter, Try at Home panels); a signed-in customer's saved address loads on /account and checkout; apply a coupon at checkout.
3. Run `node scripts/migrate-firestore-rest.mjs` once more right after the deploy: it adds anything written to Firestore between the first copy and the deploy (idempotent).
4. Lock Firestore: Firebase console, Firestore, Rules: `allow read, write: if false;` (the Admin SDK in the copy scripts bypasses rules, so a final copy still works). Leave it read-only for a week as an archive.
5. Later: delete the `FIREBASE_SERVICE_ACCOUNT` Vercel variable ONLY if GA4 has its own `GA4_SERVICE_ACCOUNT`: `lib/ga4.ts` falls back to `FIREBASE_SERVICE_ACCOUNT` to read Google Analytics. Removing it first would break the nightly GA sync.
