import type { APIRoute } from 'astro';

export const prerender = false;

// Retired. Visitor intent (cart, phone, address, booking steps) used to be written to Firestore
// here; it now goes to the event log through /api/collect (mkEvent / mkIdentify in BaseLayout).
// Kept as a no-op so pages cached before the cutover that still POST here get a clean 204.
export const POST: APIRoute = () =>
  new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
