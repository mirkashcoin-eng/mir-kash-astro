import type { APIRoute } from 'astro';

export const prerender = false;

// One-shot: creates the 3 WhatsApp message templates on the account via Meta's Graph
// API, so they don't have to be built by hand in WhatsApp Manager. Submitting a template
// still sends it to Meta for approval — this just files them. Idempotent-ish: re-running
// returns "already exists" for ones that are already there.
// Protected by CRON_SECRET (pass ?key=<secret> or an Authorization: Bearer header).

const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj, null, 2), {
    status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' },
  });

const TEMPLATES = [
  {
    name: 'order_confirmed', language: 'en', category: 'UTILITY',
    components: [{
      type: 'BODY',
      text: "Hi {{1}}, thanks for your order {{2}} with Mir Kash 💛 We've received it (total {{3}}) and will pack it with care. We'll message you when it ships.",
      example: { body_text: [['Priya', '#1042', '₹8,999']] },
    }],
  },
  {
    name: 'order_shipped', language: 'en', category: 'UTILITY',
    components: [{
      type: 'BODY',
      text: 'Hi {{1}}, your Mir Kash order {{2}} has shipped and is on its way. Thank you for choosing us 💛',
      example: { body_text: [['Priya', '#1042']] },
    }],
  },
  {
    name: 'cart_reminder', language: 'en', category: 'MARKETING',
    components: [{
      type: 'BODY',
      text: 'Hi {{1}}, you left something beautiful in your bag at Mir Kash. Complete your order here: {{2}}',
      example: { body_text: [['Priya', 'https://mirkash.com/shop']] },
    }],
  },
];

export const GET: APIRoute = async ({ request, url }) => {
  const secret = process.env.CRON_SECRET;
  const key = url.searchParams.get('key') || (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!secret || key !== secret) return new Response('unauthorized', { status: 401 });

  const token = process.env.WHATSAPP_TOKEN || '';
  const waba = process.env.WHATSAPP_WABA_ID || '1608333530921964';
  if (!token) return json({ ok: false, reason: 'WHATSAPP_TOKEN not set' });

  const results: Array<Record<string, unknown>> = [];
  for (const t of TEMPLATES) {
    try {
      const res = await fetch(`https://graph.facebook.com/v21.0/${waba}/message_templates`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(t),
      });
      const data = await res.json().catch(() => ({}));
      results.push({
        name: t.name, ok: res.ok, httpStatus: res.status,
        id: data?.id, category: data?.category, status: data?.status,
        error: data?.error?.message,
      });
    } catch (e) {
      results.push({ name: t.name, ok: false, error: String(e) });
    }
  }
  return json({ ok: true, waba, results });
};
