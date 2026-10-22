# Leaving Firestore: what is left (audited 2026-10-22)

Goal: everything reads and writes Neon, the missing data is copied once, then Firestore access is switched off.
Firebase **Auth** (admin sign-in and customer Google sign-in) is not Firestore and stays on.

## A. Admin screens that still read Firestore (`/api/admin/data`)

| Reads | Where | Neon already has | To do |
|---|---|---|---|
| People list (capped at 500) | `getPeople` in leads.ts | `v_people` / `mv_people` (new People tab uses it) | Orders, abandoned and Try at Home views stop using `getPeople`; join on Neon people |
| Visitor funnel | `getFunnel` in analytics.ts | events | Replace with a Neon query |
| Daily funnel (240 days) | `getFunnelDaily` in funnel.ts | `v_funnel_daily` + `legacy_daily` (the Daily funnel tab already reads it) | Drop it from the old feed |
| Top products | `getProductStats` | `v_products` | Replace with a Neon query |
| Newsletter subscribers | `getSubscribers` | `newsletter_signups` (copy pending, see D) | Read Neon |
| Affiliates and clicks | `getAffiliateSummary`, `clicks.ts` | `affiliates`, `affiliate_clicks` (copy pending, see D) | Read Neon |
| Try at Home page funnel, phone banner test, booking prompt, cart "Before you go" | analytics.ts | `legacy_daily` + `events` | **Done on branch `tah-reschedule`** (`lib/warehouse/panels.ts`); Firestore only as a fallback |

## B. Writes that still go to Firestore (dual-write)

| Collection | Written by |
|---|---|
| `leads`, `people` | `recordLead`, `recordMilestones` (api/lead.ts, funnel.ts) |
| `analytics_daily`, `product_stats` | `recordEvent`, `recordPromptEvent`, `recordCartExitEvent`, `recordTryAtHomeEvent` (api/track.ts) |
| `funnel_daily` | `recordMilestones` (funnel.ts) |
| `newsletter` | `recordSubscriber` (api/newsletter.ts) |
| `affiliates`, `clicks` | `clicks.ts` (go/[affiliate].ts, api/admin/affiliate.ts) |

Each already writes to Neon too. Stopping the Firestore half is what ends the daily quota problem.

## C. Data with no Neon home yet (needs a table, a migration and new code)

1. **`admins`: Team access.** `adminAuth.ts` asks `getAdminRole` before letting a non-founder into /admin. Needs an `admins` table, `team.ts` switched over, and the existing rows copied.
2. **`coupon_redemptions`: India coupon usage limits.** `coupons.ts` counts redemptions at checkout. Needs a table with a unique key on `code:orderName`, and the same checks. Checkout reads this, so it is the riskiest item.
3. **`profiles`: customer saved addresses.** Read and written straight from the browser with the Firestore SDK (`firebaseClient.ts`, used by the account page and checkout). Needs a small signed-in API and a `customer_profiles` table, and the page changed to use it.

## D. Data to copy once

| What | Size | Status |
|---|---|---|
| Affiliates, clicks, newsletter signups | 18 creators, 322 clicks, 20 signups | Script ready (`scripts/migrate-firestore-affiliates.mjs`), blocked by the daily quota |
| `admins` | small | After C1 |
| `coupon_redemptions` | small | After C2 |
| `profiles` | unknown | After C3 |
| Final top-up of leads, people, daily counters | | Re-run `scripts/migrate-firestore.mjs` just before switching off (idempotent) |

On purpose not copied: 20,989 `anon:*` lead docs (a browser, not a person). Their visits are in `events`.

## E. Switch-off order

1. Build C1 to C3 and the A items; deploy.
2. Run the copy scripts in D, then check counts against Firestore.
3. Remove the Firestore writes in B and the fallback in `panels.ts`.
4. Leave Firestore read-only for a few days as an archive, then lock it (security rules to deny all, or disable the API).
5. Keep Firebase Auth.
