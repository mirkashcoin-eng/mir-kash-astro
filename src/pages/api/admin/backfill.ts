import type { APIRoute } from 'astro';
import { requestIsAdmin } from '~/lib/adminAuth';
import { backfillLegacyLeads } from '~/lib/leads';

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

// One-time (idempotent) import of the legacy `checkout_leads` phone numbers into
// `people`, so months of captured numbers stop being invisible. Safe to re-run —
// it merges and never overwrites richer data from the live flow.
// GET is allowed too: Astro's CSRF checkOrigin rejects header-less POSTs (curl), and
// the admin credential — not the method — is what actually guards this.
const run: APIRoute = async ({ request }) => {
  if (!(await requestIsAdmin(request))) return json({ error: 'Not authorised' }, 401);
  try {
    const res = await backfillLegacyLeads();
    if (!res) return json({ error: 'Firestore service account not configured' }, 503);
    return json({ ok: true, ...res });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Backfill failed' }, 500);
  }
};

export const POST = run;
export const GET = run;
