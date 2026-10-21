import type { APIRoute } from 'astro';
import { requestIsAdmin } from '~/lib/adminAuth';
import { pg } from '~/lib/db';
import { SECTIONS, isSection, parseParams, type Run } from '~/lib/metrics';

export const prerender = false;

// Founders-only analytics numbers for /admin, one section per request:
//   GET /api/admin/metrics/{overview|acquisition|products|checkout|audience|retention|funnelDaily|trackingHealth}
//       ?from=YYYY-MM-DD&to=YYYY-MM-DD   IST days, inclusive (default: the last 28 days)
//       &bots=1 &test=1                  include bots / test numbers (default: excluded)
//       &by=source|source_medium|campaign|content &model=last|first   (acquisition only)
// Response: the section's type in src/lib/metrics/types.ts, or { error }.
// Loaded when the page (or a section) opens — never polled.
const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'private, no-store',
      'X-Robots-Tag': 'noindex, nofollow',
    },
  });

export const GET: APIRoute = async ({ request, params, url }) => {
  if (!(await requestIsAdmin(request))) return json({ error: 'Not authorised' }, 401);
  const section = params.section;
  if (!isSection(section)) return json({ error: `Unknown section. Use one of: ${Object.keys(SECTIONS).join(', ')}` }, 404);

  const p = parseParams(url.searchParams);
  if (typeof p === 'string') return json({ error: p }, 400);

  const pool = pg();
  if (!pool) return json({ error: 'Analytics database is not configured' }, 503);
  const run: Run = async (sql, args = []) => (await pool.query(sql, args)).rows;

  try {
    return json(await SECTIONS[section](run, p));
  } catch (e) {
    console.error(`[metrics] ${section} failed:`, e);
    return json({ error: 'Could not load these numbers' }, 500);
  }
};
