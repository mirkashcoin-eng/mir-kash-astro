import type { APIRoute } from 'astro';
import { recordLead } from '~/lib/leads';

export const prerender = false;

// Records a visitor's intent (added to cart / entered phone / entered address) against
// their anonymous session id, for the founders' People view. JSON body (bypasses CSRF
// checkOrigin).
const noContent = () => new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });

const EVENTS = ['visit', 'add_to_cart', 'phone', 'address'] as const;

export const POST: APIRoute = async ({ request }) => {
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return noContent(); }

  const sessionId = String(body.sessionId || '').slice(0, 64);
  const event = String(body.event || '') as (typeof EVENTS)[number];
  if (!sessionId || !(EVENTS as readonly string[]).includes(event)) return noContent();

  const str = (v: unknown, n = 120) => (v == null ? undefined : String(v).slice(0, n));
  // Cart snapshot (add_to_cart): trust nothing from the browser — clamp shape and size.
  const c = body.cart as Record<string, unknown> | undefined;
  const cart = c && typeof c === 'object' ? {
    total: Number(c.total) || 0,
    currency: str(c.currency, 8) || 'INR',
    quantity: Number(c.quantity) || 0,
    lines: (Array.isArray(c.lines) ? c.lines : []).slice(0, 25).map((l: Record<string, unknown>) => ({
      title: str(l?.title) || '',
      variant: str(l?.variant) || null,
      quantity: Number(l?.quantity) || 0,
      price: Number(l?.price) || 0,
    })),
  } : undefined;

  await recordLead({
    sessionId,
    event,
    phone: str(body.phone, 20),
    email: str(body.email),
    name: str(body.name),
    item: str(body.item),
    market: str(body.market, 16),
    uid: str(body.uid),
    address1: str(body.address1, 200),
    city: str(body.city, 80),
    province: str(body.province, 80),
    pin: str(body.pin, 10),
    cart,
  });
  return noContent();
};
