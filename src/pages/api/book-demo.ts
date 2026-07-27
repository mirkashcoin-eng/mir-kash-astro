import type { APIRoute } from 'astro';
import { createDemoBooking } from '~/lib/shopify/admin';

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
}

// Public "Book a Home Demo" (Mumbai). Records the request as a tagged Shopify draft order.
export const POST: APIRoute = async ({ request }) => {
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

  const bags = Array.isArray(body.bags)
    ? body.bags.filter((b): b is { variantId: string; title: string } => Boolean(b && b.variantId)).map((b) => ({ variantId: b.variantId, title: (b.title || 'Bag').toString() }))
    : [];

  if (!date || !slot) return json({ error: 'Please choose a date and time for your demo.' }, 400);
  if (bags.length < 1) return json({ error: 'Please select at least one bag.' }, 400);
  if (bags.length > 6) return json({ error: 'You can select up to 6 bags for a home demo.' }, 400);
  if (!name || !email || !phone || !address) return json({ error: 'Please fill in your name, phone, email and address.' }, 400);
  if (phone.length !== 10) return json({ error: 'Please enter a valid 10-digit phone number.' }, 400);
  if (!/^40\d{4}$/.test(pin)) return json({ error: 'Home demos are Mumbai-only for now — please enter a Mumbai PIN code.' }, 400);

  const result = await createDemoBooking({
    bags, date, slot, name, email, phone: `+91${phone}`, address, area, zip: pin,
  });

  return result
    ? json({ ok: true })
    : json({ error: 'Something went wrong booking your demo. Please try again or email hello@mirkash.com.' }, 502);
};
