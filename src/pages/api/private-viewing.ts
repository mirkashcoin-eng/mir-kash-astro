import type { APIRoute } from 'astro';
import { createMeeting, wherebyConfigured } from '~/lib/whereby';
import { createPrivateViewingBooking } from '~/lib/shopify/admin';

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
  city?: string; country?: string;
}

// IST is a fixed UTC+5:30 offset, no DST — these are the same three windows shown
// in the UI (PrivateViewing.astro), mapped to their end hour so the Whereby room
// stays open through the actual appointment rather than expiring early. An
// unrecognised slot falls back to the latest window, the safest direction to be wrong in.
function slotEndHourIST(slot: string): number {
  if (slot.startsWith('Morning')) return 14;
  if (slot.startsWith('Afternoon')) return 17;
  return 20;
}

// Public "Book a Private Viewing". Records the request as a tagged Shopify draft
// order (same durable-record pattern as /api/book-demo.ts) and mints a Whereby
// room sized to the real appointment — not just "now + a few hours" — since the
// room's join link is only ever read later, from the admin dashboard, not shown
// to the customer at booking time (see PrivateViewing.astro's confirm step).
export const POST: APIRoute = async ({ request }) => {
  if (!wherebyConfigured()) {
    return json({ error: 'Video appointments are not configured yet.' }, 503);
  }

  let body: Body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid request.' }, 400);
  }

  const date = (body.date ?? '').trim();
  const slot = (body.slot ?? '').trim();
  const name = (body.name ?? '').trim();
  // Phone arrives as a single E.164-ish string (ISD code + number already joined
  // client-side) — kept as typed rather than normalised to one country's format,
  // since this flow is global.
  const phone = (body.phone ?? '').trim();
  const email = (body.email ?? '').trim();
  const city = (body.city ?? '').trim();
  const country = (body.country ?? '').trim();

  const bags = Array.isArray(body.bags)
    ? body.bags.filter((b): b is { variantId: string; title: string } => Boolean(b && b.variantId)).map((b) => ({ variantId: b.variantId, title: (b.title || 'Bag').toString() }))
    : [];

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !slot) return json({ error: 'Please choose a day and a time for your Private Viewing.' }, 400);
  if (bags.length < 1) return json({ error: 'Please select at least one bag.' }, 400);
  if (bags.length > 6) return json({ error: 'You can select up to 6 bags for a Private Viewing.' }, 400);
  if (!name || !email) return json({ error: 'Please fill in your name and email.' }, 400);
  const phoneDigits = phone.replace(/\D/g, '');
  if (phoneDigits.length < 7 || phoneDigits.length > 15) return json({ error: 'Please enter a valid phone number, including your country code.' }, 400);

  const [y, m, d] = date.split('-').map(Number);
  const endHourIST = slotEndHourIST(slot);
  // IST = UTC+5:30, fixed. Two hours of slack past the slot's end, same reasoning
  // as before: a 15–30 minute viewing can run long, and being cut off mid-call is
  // the worst outcome.
  const endUTCms = Date.UTC(y, (m ?? 1) - 1, d, endHourIST, 0, 0) - (5 * 60 + 30) * 60 * 1000;
  const endDate = new Date(endUTCms + 2 * 60 * 60 * 1000);

  const meeting = await createMeeting({ endDate, roomNamePrefix: 'private-viewing' });
  if (!meeting) {
    return json({ error: 'Could not open a viewing room. Please try again.' }, 502);
  }
  const roomId = meeting.roomUrl.split('/').pop() || '';

  const result = await createPrivateViewingBooking({
    bags, date, slot, name, email, phone, city, country,
    roomId, hostRoomUrl: meeting.hostRoomUrl,
  });

  return result
    ? json({ ok: true })
    : json({ error: 'Something went wrong booking your viewing. Please try again or email hello@mirkash.com.' }, 502);
};
