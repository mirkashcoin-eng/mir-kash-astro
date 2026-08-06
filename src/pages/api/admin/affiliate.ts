import type { APIRoute } from 'astro';
import { requestIsAdmin } from '~/lib/adminAuth';
import { createAffiliate, SLUG_RE } from '~/lib/clicks';

export const prerender = false;

const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex, nofollow' },
  });

// Founders-only: mint an affiliate link. Same auth as /api/admin/data.
export const POST: APIRoute = async ({ request }) => {
  if (!(await requestIsAdmin(request))) return json({ error: 'Not authorised' }, 401);

  let body: { slug?: string; label?: string };
  try { body = await request.json(); } catch { return json({ error: 'Bad request' }, 400); }

  const slug = (body.slug || '').trim().toLowerCase();
  if (!SLUG_RE.test(slug)) {
    return json({ error: 'Use 3–40 characters: lowercase letters, numbers and hyphens.' }, 400);
  }

  const res = await createAffiliate(slug, (body.label || '').trim() || undefined);
  if (res === 'taken') return json({ error: `“${slug}” is already taken.` }, 409);
  if (res === 'unavailable') return json({ error: 'Firestore service account not configured' }, 503);
  return json({ ok: true, slug });
};
