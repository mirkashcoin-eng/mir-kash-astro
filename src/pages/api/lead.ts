import type { APIRoute } from 'astro';
import { recordLead } from '~/lib/leads';

export const prerender = false;

// Records a visitor's intent (added to cart / entered phone) against their anonymous
// session id, for the founders' Leads view. JSON body (bypasses CSRF checkOrigin).
const noContent = () => new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });

export const POST: APIRoute = async ({ request }) => {
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return noContent(); }

  const sessionId = String(body.sessionId || '').slice(0, 64);
  const event = String(body.event || '');
  if (!sessionId || (event !== 'add_to_cart' && event !== 'phone')) return noContent();

  const str = (v: unknown, n = 120) => (v == null ? undefined : String(v).slice(0, n));
  await recordLead({
    sessionId,
    event,
    phone: str(body.phone, 20),
    email: str(body.email),
    name: str(body.name),
    item: str(body.item),
    market: str(body.market, 16),
    uid: str(body.uid),
  });
  return noContent();
};
