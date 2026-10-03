import type { APIRoute } from 'astro';
import { recordCartExitEvent, recordEvent, recordPromptEvent } from '~/lib/analytics';

export const prerender = false;

// Anonymous funnel beacon. The browser sends the stage name (via navigator.sendBeacon)
// and we increment a daily aggregate counter. No cookies, no body beyond the stage name,
// no personal data. Only known stage names are accepted; anything else is ignored.
const noContent = () => new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });

async function handle(request: Request, url: URL, bot: string): Promise<Response> {
  let e = url.searchParams.get('e') || '';
  if (!e) {
    try { e = (await request.text()).trim(); } catch { /* ignore */ }
  }
  const product = (url.searchParams.get('product') || '').slice(0, 120);
  if (e.startsWith('vp_')) {
    // Booking-prompt impressions/outcomes. Crawlers run page scripts too; keep them out of the rates.
    if (!bot) await recordPromptEvent(e, (url.searchParams.get('page') || '').slice(0, 12), (url.searchParams.get('offer') || '').slice(0, 12));
  } else if (e.startsWith('cx_')) {
    // Cart "Before you go" panel. Same crawler exclusion as the booking prompt.
    if (!bot) await recordCartExitEvent(e.slice(0, 40), (url.searchParams.get('offer') || '').slice(0, 12));
  } else if (e) await recordEvent(e.slice(0, 40), product || undefined);
  return noContent();
}

export const POST: APIRoute = ({ request, url, locals }) => handle(request, url, locals.botName);
export const GET: APIRoute = ({ request, url, locals }) => handle(request, url, locals.botName);
