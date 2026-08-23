import type { APIRoute } from 'astro';
import { createMeeting, wherebyConfigured } from '~/lib/whereby';

export const prerender = false;

// Creates a Whereby room for a Private Viewing.
//
// Prototype scope: this only mints a room and hands back where to join. It does not
// record a booking — no Shopify draft order, no admin entry, no WhatsApp. That lands
// when the flow is wired up, at which point this should also stop being callable
// anonymously (right now anyone who finds it can create rooms against the account).
export const POST: APIRoute = async ({ request }) => {
  if (!wherebyConfigured()) {
    return new Response(JSON.stringify({ error: 'Video appointments are not configured yet.' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let when: Date | null = null;
  try {
    const body = await request.json();
    if (body?.startsAt) when = new Date(body.startsAt);
  } catch { /* body is optional — default to a room usable right now */ }

  // Rooms expire at endDate, so leave slack: a viewing runs 15–30 minutes but an
  // engaged customer can overrun, and being cut off mid-call is the worst outcome.
  const base = when && !Number.isNaN(when.getTime()) ? when : new Date();
  const endDate = new Date(base.getTime() + 3 * 60 * 60 * 1000);

  const meeting = await createMeeting({ endDate, roomNamePrefix: 'private-viewing' });
  if (!meeting) {
    return new Response(JSON.stringify({ error: 'Could not open a viewing room. Please try again.' }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // roomName comes back as "/<uuid>"; the id alone is enough to rebuild the URL on
  // the viewing page, so no storage is needed to look a room back up.
  const roomId = meeting.roomUrl.split('/').pop() || '';

  return new Response(
    JSON.stringify({
      ok: true,
      roomId,
      roomUrl: meeting.roomUrl,
      viewingPath: `/viewing/${roomId}`,
      endDate: meeting.endDate,
    }),
    { status: 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } },
  );
};
