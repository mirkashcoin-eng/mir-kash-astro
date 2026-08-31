import type { APIRoute } from 'astro';
import { subscribeEmail } from '~/lib/shopify/admin';
import { recordSubscriber } from '~/lib/newsletter';

export const prerender = false;

const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });

export const POST: APIRoute = async ({ request, locals }) => {
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

  // Best-effort: create the Shopify customer + marketing consent (needs the
  // `write_customers` scope). Firestore is the source of truth for the founders'
  // list, so a signup is kept even when Shopify is unavailable.
  const shop = await subscribeEmail(email);
  const market = (locals?.market as string | undefined) ?? undefined;
  const stored = await recordSubscriber(email, { source: 'footer', market, shopifyOk: shop.ok });

  if (stored || shop.ok) return json({ ok: true });
  return json({ ok: false, error: shop.error || 'Could not subscribe right now.' }, 502);
};
