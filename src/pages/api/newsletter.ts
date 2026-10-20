import type { APIRoute } from 'astro';
import { subscribeEmail } from '~/lib/shopify/admin';
import { recordSubscriber } from '~/lib/newsletter';
import { sendMetaEvent } from '~/lib/meta-capi';
import { SITE_ORIGIN } from '~/lib/markets';

export const prerender = false;

const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });

export const POST: APIRoute = async (ctx) => {
  const { request, locals, cookies } = ctx;
  let email = '';
  let fbEventId = '';
  try {
    const body = await request.json();
    email = (body?.email ?? '').trim().toLowerCase();
    fbEventId = typeof body?.fbEventId === 'string' ? body.fbEventId : '';
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

  if (!stored && !shop.ok) return json({ ok: false, error: shop.error || 'Could not subscribe right now.' }, 502);

  // Meta Conversions API — server-side mirror of the browser Lead pixel fired by the
  // footer form on success; shares fbEventId with it so Meta dedupes the two.
  if (/^[\w-]{6,64}$/.test(fbEventId)) {
    let ip: string | undefined;
    try { ip = ctx.clientAddress; } catch { /* unsupported on this adapter/route */ }
    await sendMetaEvent({
      eventName: 'Lead',
      eventId: fbEventId,
      sourceUrl: SITE_ORIGIN,
      user: {
        email,
        country: (locals?.country as string | undefined) ?? null,
        ip,
        userAgent: request.headers.get('user-agent'),
        fbp: cookies.get('_fbp')?.value,
        fbc: cookies.get('_fbc')?.value,
      },
      customData: { content_name: 'Newsletter' },
    });
  }
  return json({ ok: true });
};
