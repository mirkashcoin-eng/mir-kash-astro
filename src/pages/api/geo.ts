import type { APIRoute } from 'astro';

export const prerender = false;

// Cities of the Mumbai Metropolitan Region — a visitor here can book a home demo.
const MUMBAI_AREA = [
  'mumbai', 'navi mumbai', 'thane', 'kalyan', 'dombivli', 'mira', 'bhayandar',
  'vasai', 'virar', 'ulhasnagar', 'panvel', 'badlapur', 'ambernath', 'ambarnath',
];

// Tells the storefront whether the visitor is in the Mumbai area (from Vercel's
// edge geolocation of their IP), so Home Demo shows only for them. Pages are
// CDN-cached, so this is fetched client-side and is intentionally per-user (no-store).
export const GET: APIRoute = ({ request, url }) => {
  const h = request.headers;
  let city = h.get('x-vercel-ip-city') || '';
  try { city = decodeURIComponent(city); } catch { /* keep raw */ }
  const country = h.get('x-vercel-ip-country') || '';

  // Local dev / manual testing: ?city=Mumbai (only honoured off-Vercel).
  const isDev = import.meta.env.DEV;
  const force = url.searchParams.get('city');
  if (isDev && force) city = force;

  const cityLc = city.toLowerCase();
  const mumbai = (country === 'IN' || isDev) && MUMBAI_AREA.some((c) => cityLc.includes(c));

  return new Response(JSON.stringify({ mumbai, city }), {
    headers: {
      'Content-Type': 'application/json',
      // Per-user, cached briefly in the visitor's own browser (never shared/CDN).
      'Cache-Control': 'private, max-age=1800',
    },
  });
};
