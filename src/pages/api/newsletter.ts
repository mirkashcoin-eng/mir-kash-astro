import type { APIRoute } from 'astro';
import { subscribeEmail } from '~/lib/shopify/admin';

export const prerender = false;

const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });

export const POST: APIRoute = async ({ request }) => {
  let email = '';
  try {
    const body = await request.json();
    email = (body?.email ?? '').trim().toLowerCase();
  } catch {
    return json({ ok: false, error: 'Invalid request.' }, 400);
  }

  if (!/^\S+@\S+\.\S+$/.test(email)) {
    return json({ ok: false, error: 'Please enter a valid email address.' }, 400);
  }

  const res = await subscribeEmail(email);
  if (!res.ok) return json({ ok: false, error: res.error || 'Could not subscribe.' }, 502);
  return json({ ok: true });
};
