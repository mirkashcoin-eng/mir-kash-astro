import type { APIRoute } from 'astro';
import { saveCheckoutLead } from '~/lib/supabase';

export const prerender = false;

// Captures the phone of anyone who clicks "Continue to Delivery" — so we can see
// who started checkout even if they don't finish. Best-effort; never blocks.
export const POST: APIRoute = async ({ request }) => {
  let body: { phone?: string; email?: string };
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400 });
  }

  const phone = String(body.phone ?? '').replace(/\D/g, '');
  if (phone.length >= 10) {
    await saveCheckoutLead({ phone: phone.slice(-10), email: body.email || null });
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
};
