import type { APIRoute } from 'astro';
import { getOrdersByEmail, requestReturn } from '~/lib/shopify/admin';

export const prerender = false;

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

// digits only, so "#1042" / "1042 " / "1042" all compare equal
const digits = (s: string) => s.replace(/\D/g, '');

// Public returns portal: verifies the order belongs to the given email (by matching
// the order number against that email's Shopify orders), then tags it 'return-requested'
// with a reason note — the same mechanism the signed-in account flow uses.
export const POST: APIRoute = async ({ request }) => {
  let body: { order?: string; email?: string; reason?: string };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid request.' }, 400);
  }

  const orderNum = (body.order ?? '').trim();
  const email = (body.email ?? '').trim().toLowerCase();
  const reason = (body.reason ?? '').slice(0, 500);

  if (!orderNum || !email) {
    return json({ error: 'Please enter your order number and email.' }, 400);
  }
  if (!digits(orderNum)) {
    return json({ error: 'That order number doesn’t look right.' }, 400);
  }

  // Only orders placed with this email are returned — this is the ownership check.
  const orders = await getOrdersByEmail(email);
  const target = orders.find((o) => digits(o.name) === digits(orderNum));
  if (!target) {
    return json(
      { error: 'We couldn’t find an order with that number and email. Please double-check both.' },
      404,
    );
  }

  const ok = await requestReturn(target.id, reason);
  return ok
    ? json({ ok: true, order: target.name })
    : json({ error: 'Something went wrong on our end. Please email returns@mirkash.com.' }, 502);
};
