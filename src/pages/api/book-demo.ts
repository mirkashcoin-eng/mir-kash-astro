import type { APIRoute } from 'astro';
import { createDemoBooking } from '~/lib/shopify/admin';
import { contentId, sendMetaEvent } from '~/lib/meta-capi';
import { SITE_ORIGIN } from '~/lib/markets';

export const prerender = false;

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

interface Bag { variantId?: string; title?: string }
interface Body {
  date?: string; slot?: string; bags?: Bag[];
  name?: string; phone?: string; email?: string;
  address?: string; area?: string; pin?: string;
  city?: string; country?: string;
  fbEventId?: string;
  abVariant?: string;
}

// Public "Book a Home Demo" (Mumbai). Records the request as a tagged Shopify draft order.
export const POST: APIRoute = async (ctx) => {
  const { request, cookies } = ctx;
  let body: Body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid request.' }, 400);
  }

  const date = (body.date ?? '').trim();
  const slot = (body.slot ?? '').trim();
  const name = (body.name ?? '').trim();
  const phone = (body.phone ?? '').replace(/\D/g, '').slice(-10);
  const email = (body.email ?? '').trim();
  const address = (body.address ?? '').trim();
  const area = (body.area ?? '').trim();
  const pin = (body.pin ?? '').trim();
  const city = (body.city ?? '').trim();
  const country = (body.country ?? 'IN').trim().toUpperCase();
  // Same shape as ProductPage's newFbEventId ids; anything else is ignored, never trusted.
  // A page cached from before the browser Schedule pixel existed sends none, so there's
  // no browser event to dedupe against — mint a server-only id so the booking still counts.
  const fbEventId = /^[\w-]{6,64}$/.test(body.fbEventId ?? '')
    ? body.fbEventId!
    : 'sch-srv-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);

  // Phone banner test version (src/lib/ab-test.ts); only 'A' or 'B' is kept.
  const abVariant = body.abVariant === 'A' || body.abVariant === 'B' ? body.abVariant : undefined;

  const bags = Array.isArray(body.bags)
    ? body.bags.filter((b): b is { variantId: string; title: string } => Boolean(b && b.variantId)).map((b) => ({ variantId: b.variantId, title: (b.title || 'Bag').toString() }))
    : [];

  if (!date || !slot) return json({ error: 'Please choose a date and time for your Try at Home.' }, 400);
  if (bags.length < 1) return json({ error: 'Please select at least one bag.' }, 400);
  if (bags.length > 6) return json({ error: 'You can select up to 6 bags for a Try at Home.' }, 400);
  // Email is no longer asked for (the team follows up by WhatsApp); one sent by an
  // older cached page is still kept if it looks like an address.
  if (!name || !phone || !address) return json({ error: 'Please fill in your name, phone and address.' }, 400);
  if (phone.length !== 10) return json({ error: 'Please enter a valid 10-digit phone number.' }, 400);
  if (email && !/^\S+@\S+\.\S+$/.test(email)) return json({ error: 'Please check your email address.' }, 400);
  if (!/^\d{6}$/.test(pin)) return json({ error: 'Please enter a valid 6-digit PIN code.' }, 400);
  // The form switches anyone outside India to Private Viewing before they get here.
  // The city isn't checked against the Mumbai list: the visitor may have typed a
  // suburb we don't list and confirmed it's in the Mumbai area.
  if (country !== 'IN') return json({ error: 'Try at Home is only available in Mumbai — please book a Private Viewing instead.' }, 400);

  const fbp = cookies.get('_fbp')?.value;
  const fbc = cookies.get('_fbc')?.value;
  const result = await createDemoBooking({
    bags, date, slot, name, email: email || undefined, phone: `+91${phone}`, address, area, zip: pin, city,
    meta: { fbp, fbc, eventId: fbEventId },
    abVariant,
  });

  // Meta Conversions API — server-side mirror of the browser Schedule pixel fired by
  // BookDemo.astro on success. Shares fbEventId with it so Meta dedupes the two. This is
  // the event the Try at Home campaign optimises for, so it carries every match key the
  // form collects. Only sent once the booking really exists.
  if (result) {
    let ip: string | undefined;
    try { ip = ctx.clientAddress; } catch { /* unsupported on this adapter/route */ }
    const [firstName, ...rest] = name.split(/\s+/);
    await sendMetaEvent({
      eventName: 'Schedule',
      eventId: fbEventId,
      sourceUrl: `${SITE_ORIGIN}/try-at-home`,
      user: {
        email: email || null,
        phone: `91${phone}`,
        firstName,
        lastName: rest.join(' ') || null,
        city: city || 'Mumbai',
        zip: pin,
        country: 'IN',
        externalId: `+91${phone}`,
        ip,
        userAgent: request.headers.get('user-agent'),
        fbp,
        fbc,
      },
      customData: {
        content_name: 'Try at Home',
        content_type: 'product',
        content_ids: bags.map((b) => contentId(b.variantId)),
        num_items: bags.length,
        ...(abVariant ? { ab_variant: abVariant } : {}),
      },
    });
  }

  return result
    ? json({ ok: true })
    : json({ error: 'Something went wrong booking your demo. Please try again or email hello@mirkash.com.' }, 502);
};
