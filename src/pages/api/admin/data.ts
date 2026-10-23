import type { APIRoute } from 'astro';
import { requestIsAdmin } from '~/lib/adminAuth';
import { getDemoBookings, getPrivateViewingBookings, getAbandonedCheckouts, getAbandonedDrafts, getRecentOrders } from '~/lib/shopify/admin';
import { getTryAtHomePanels } from '~/lib/warehouse/panels';
import { verdict, MIN_DAYS, MIN_PER_ARM } from '~/lib/ab-test';
import { q } from '~/lib/db';
import { getAffiliateSummary } from '~/lib/clicks';
import { getSubscribers } from '~/lib/newsletter';

export const prerender = false;

const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'private, no-store',
      'X-Robots-Tag': 'noindex, nofollow',
    },
  });

// Founders-only data feed for /admin. Auth = Firebase ID token (Bearer) whose email
// must be a root founder (ADMIN_EMAILS) or hold the 'full' role in Team access.
// India Admin data only.
export const GET: APIRoute = async ({ request }) => {
  if (!(await requestIsAdmin(request))) return json({ error: 'Not authorised' }, 401);

  const [demos, viewings, nativeAbandoned, draftAbandoned, orders, subscribers, panels, affiliates, seen] = await Promise.all([
    getDemoBookings(),
    getPrivateViewingBookings(),
    getAbandonedCheckouts(), // Global store — Shopify-hosted checkout
    getAbandonedDrafts(),    // India store — open Cashfree payment drafts
    getRecentOrders(),
    getSubscribers(),        // newsletter signups (Neon)
    getTryAtHomePanels(),    // Try at Home counters from Neon (legacy copy + event log)
    getAffiliateSummary(),   // creators, clicks, orders, revenue (Neon)
    // Last-seen times of people active in the last 2 weeks, for the "new" badge on People.
    q<{ last_seen: Date }>(`SELECT last_seen FROM mv_people WHERE NOT is_bot AND NOT is_test AND last_seen > now() - interval '14 days'`),
  ]);
  const { prompt, cartExit, tryAtHome, bannerCounts } = panels ?? { prompt: null, cartExit: null, tryAtHome: null, bannerCounts: null };
  const abandoned = [...draftAbandoned, ...nativeAbandoned].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
  const people = (seen ?? []).map((r) => ({ lastSeen: r.last_seen.toISOString() }));

  // Phone banner test: per-version counts plus the verdict (src/lib/ab-test.ts).
  // "Chose pieces" = reached the day-and-time step.
  const bannerTest = bannerCounts && bannerCounts.firstDay
    ? {
        ...bannerCounts,
        minPerArm: MIN_PER_ARM,
        minDays: MIN_DAYS,
        verdict: verdict(
          { visitors: bannerCounts.A.th_view, choseP: bannerCounts.A.th_datetime, booked: bannerCounts.A.th_booked },
          { visitors: bannerCounts.B.th_view, choseP: bannerCounts.B.th_datetime, booked: bannerCounts.B.th_booked },
          bannerCounts.days,
        ),
      }
    : null;

  return json({ demos, viewings, abandoned, orders, people, affiliates, subscribers, prompt, cartExit, tryAtHome, bannerTest });
};
