import type { APIRoute } from 'astro';

export const prerender = false;

// Cities of the Mumbai Metropolitan Region — a visitor here can book a home demo.
const MUMBAI_AREA = [
  'mumbai', 'navi mumbai', 'thane', 'kalyan', 'dombivli', 'mira', 'bhayandar',
  'vasai', 'virar', 'ulhasnagar', 'panvel', 'badlapur', 'ambernath', 'ambarnath',
];

// Tells the storefront whether the visitor is in the Mumbai area (from Vercel's
// edge geolocation of their IP), so Try at Home shows only for them. Pages are
// CDN-cached, so this is fetched client-side and is intentionally per-user.
//
// Every geolocation header the edge sends is echoed back, because the city match
// below currently never passes: x-vercel-ip-city arrives empty on this deployment
// while x-vercel-ip-country is populated ("IN") — what it looks like when precise
// geolocation isn't available. Reading this endpoint from Mumbai tells us whether
// latitude/longitude are populated; if they are, the gate can move to a radius
// around Mumbai and stop depending on the city string entirely.
export const GET: APIRoute = ({ request, url }) => {
  const h = request.headers;
  let city = h.get('x-vercel-ip-city') || '';
  try { city = decodeURIComponent(city); } catch { /* keep raw */ }
  const country = h.get('x-vercel-ip-country') || '';
  const region = h.get('x-vercel-ip-country-region') || '';
  const latitude = h.get('x-vercel-ip-latitude') || '';
  const longitude = h.get('x-vercel-ip-longitude') || '';
  const timezone = h.get('x-vercel-ip-timezone') || '';

  // Local dev / manual testing: ?city=Mumbai (only honoured off-Vercel).
  const isDev = import.meta.env.DEV;
  const force = url.searchParams.get('city');
  if (isDev && force) city = force;

  const cityLc = city.toLowerCase();
  const mumbai = (country === 'IN' || isDev) && MUMBAI_AREA.some((c) => cityLc.includes(c));

  return new Response(
    JSON.stringify({ mumbai, city, region, country, latitude, longitude, timezone }),
    {
      headers: {
        'Content-Type': 'application/json',
        // Per-user, cached briefly in the visitor's own browser (never shared/CDN).
        // Kept short so a negative answer from one network doesn't stick around
        // after the visitor moves to another.
        'Cache-Control': 'private, max-age=300',
      },
    },
  );
};
