import type { APIRoute } from 'astro';

export const prerender = false;

// Retired. The anonymous daily counters this wrote to Firestore (visits, product views, booking
// prompt, cart-exit and Try at Home steps) now come from the event log, which every page already
// feeds through /api/collect. Kept as a no-op so pages cached before the cutover that still send
// the beacon get a clean 204.
const noContent = () => new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });

export const POST: APIRoute = noContent;
export const GET: APIRoute = noContent;
