import type { APIRoute } from 'astro';
import { recordEvent } from '~/lib/analytics';

export const prerender = false;

// Anonymous funnel beacon. The browser sends the stage name (via navigator.sendBeacon)
// and we increment a daily aggregate counter. No cookies, no body beyond the stage name,
// no personal data. Only known stage names are accepted; anything else is ignored.
const noContent = () => new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });

async function handle(request: Request, url: URL): Promise<Response> {
  let e = url.searchParams.get('e') || '';
  if (!e) {
    try { e = (await request.text()).trim(); } catch { /* ignore */ }
  }
  const product = (url.searchParams.get('product') || '').slice(0, 120);
  if (e) await recordEvent(e.slice(0, 40), product || undefined);
  return noContent();
}

export const POST: APIRoute = ({ request, url }) => handle(request, url);
export const GET: APIRoute = ({ request, url }) => handle(request, url);
