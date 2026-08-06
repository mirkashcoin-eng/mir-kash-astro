import type { APIRoute } from 'astro';
import { requestIsAdmin } from '~/lib/adminAuth';
import { getPersonJourney } from '~/lib/leads';

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

// One person's full timeline, stitched across every session they've ever had.
// Fetched on demand when a founder opens someone in /admin.
export const GET: APIRoute = async ({ request, url }) => {
  if (!(await requestIsAdmin(request))) return json({ error: 'Not authorised' }, 401);
  const id = (url.searchParams.get('id') || '').slice(0, 64);
  if (!id) return json({ error: 'id required' }, 400);
  return json({ steps: await getPersonJourney(id) });
};
