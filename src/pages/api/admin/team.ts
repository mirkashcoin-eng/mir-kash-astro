import type { APIRoute } from 'astro';
import { adminEmails, isAdmin } from '~/lib/adminAuth';
import { getAdminRole, listAdminUsers, removeAdminUser, upsertAdminUser, type AdminRole } from '~/lib/adminRoles';
import { verifyFirebaseUser } from '~/lib/firebaseAuth';

export const prerender = false;

const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex, nofollow' },
  });

const isRole = (v: unknown): v is AdminRole => v === 'full' || v === 'affiliate';

// Founders-only endpoint (root ADMIN_EMAILS, or a Firestore 'full' grant — both
// count as founders here). Verifies the caller once and hands back their email,
// so a granted action can be attributed in the audit trail.
async function foundersOnly(request: Request): Promise<string | null> {
  const token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token) return null;
  const user = await verifyFirebaseUser(token);
  if (!user?.email) return null;
  if (isAdmin(user.email)) return user.email;
  const role = await getAdminRole(user.email);
  return role === 'full' ? user.email : null;
}

// Who else has dashboard access, and at what role. Root founders (ADMIN_EMAILS)
// are listed read-only — they're redeploy-only by design; everyone else here is
// managed live via this endpoint.
export const GET: APIRoute = async ({ request }) => {
  if (!(await foundersOnly(request))) return json({ error: 'Not authorised' }, 401);
  const team = await listAdminUsers();
  return json({ founders: adminEmails(), team });
};

export const POST: APIRoute = async ({ request }) => {
  const caller = await foundersOnly(request);
  if (!caller) return json({ error: 'Not authorised' }, 401);

  let body: { email?: string; role?: string; label?: string };
  try { body = await request.json(); } catch { return json({ error: 'Bad request' }, 400); }

  const email = (body.email || '').trim().toLowerCase();
  if (!email || !email.includes('@')) return json({ error: 'A valid email is required' }, 400);
  if (!isRole(body.role)) return json({ error: "role must be 'full' or 'affiliate'" }, 400);
  if (adminEmails().includes(email)) return json({ error: 'That email is already a founder' }, 400);

  const res = await upsertAdminUser(email, body.role, caller, (body.label || '').trim() || undefined);
  if (res === 'unavailable') return json({ error: 'Firestore service account not configured' }, 503);
  return json({ ok: true });
};

export const DELETE: APIRoute = async ({ request }) => {
  if (!(await foundersOnly(request))) return json({ error: 'Not authorised' }, 401);

  let body: { email?: string };
  try { body = await request.json(); } catch { return json({ error: 'Bad request' }, 400); }

  const email = (body.email || '').trim().toLowerCase();
  if (!email) return json({ error: 'email is required' }, 400);

  const res = await removeAdminUser(email);
  if (res === 'unavailable') return json({ error: 'Firestore service account not configured' }, 503);
  return json({ ok: true });
};
