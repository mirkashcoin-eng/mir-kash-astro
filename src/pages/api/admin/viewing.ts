import type { APIRoute } from 'astro';
import { requestIsAdmin } from '~/lib/adminAuth';
import { confirmViewing, completeViewing } from '~/lib/shopify/admin';

export const prerender = false;

const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex, nofollow' },
  });

// Founders-only: update a Private Viewing booking's status (confirm with a date/
// time, or mark completed). Mirrors /api/admin/demo.ts exactly — same auth, same
// shape — for Private Viewing instead of Try at Home.
export const POST: APIRoute = async ({ request }) => {
  if (!(await requestIsAdmin(request))) return json({ error: 'Not authorised' }, 401);

  let body: { id?: string; action?: string; date?: string; time?: string };
  try { body = await request.json(); } catch { return json({ error: 'Bad request' }, 400); }

  const id = (body.id || '').trim();
  if (!id.startsWith('gid://shopify/DraftOrder/')) return json({ error: 'Invalid booking id' }, 400);

  if (body.action === 'confirm') {
    const date = (body.date || '').trim();
    const time = (body.time || '').trim();
    if (!date || !time) return json({ error: 'Date and time are required' }, 400);
    const ok = await confirmViewing(id, date, time);
    return ok
      ? json({ ok: true, status: 'confirmed', confirmedDate: date, confirmedTime: time })
      : json({ error: 'Could not confirm the booking' }, 502);
  }

  if (body.action === 'complete') {
    const ok = await completeViewing(id);
    return ok ? json({ ok: true, status: 'completed' }) : json({ error: 'Could not update the booking' }, 502);
  }

  return json({ error: 'Unknown action' }, 400);
};
