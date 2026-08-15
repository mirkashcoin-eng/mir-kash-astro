import type { APIRoute } from 'astro';

export const prerender = false;

function env(k: string): string {
  if (typeof process !== 'undefined' && process.env && process.env[k]) return process.env[k] as string;
  const m = import.meta.env as Record<string, string | undefined>;
  return m[k] ?? '';
}

// WhatsApp Cloud API webhook.
//  GET  — Meta's verification handshake: echoes hub.challenge when the verify token
//         matches WHATSAPP_VERIFY_TOKEN. This is all that's needed to "Verify and save".
//  POST — inbound events (delivery/read receipts, replies). Acknowledged with 200 so
//         Meta keeps the subscription; we don't act on them yet.
export const GET: APIRoute = ({ url }) => {
  const mode = url.searchParams.get('hub.mode');
  const token = url.searchParams.get('hub.verify_token');
  const challenge = url.searchParams.get('hub.challenge') ?? '';
  const verify = env('WHATSAPP_VERIFY_TOKEN');
  if (mode === 'subscribe' && verify && token === verify) {
    return new Response(challenge, { status: 200, headers: { 'Content-Type': 'text/plain' } });
  }
  return new Response('forbidden', { status: 403 });
};

export const POST: APIRoute = async ({ request }) => {
  try { await request.json(); } catch { /* ignore */ }
  return new Response('ok', { status: 200, headers: { 'Cache-Control': 'no-store' } });
};
