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
// City is the primary signal, with latitude/longitude as a fallback: the city header
// has been observed arriving empty at least once, and without a fallback that single
// miss hides Try at Home everywhere. Both come from the same city-level lookup (the
// coordinates are Mumbai's centroid, not a precise fix), so the radius is not more
// accurate than the city string — just resilient to it being absent, and to spellings
// the list doesn't carry ("Bombay") or suburb names ("Borivali", "Andheri").
//
// All headers are echoed back so this endpoint stays self-diagnosing.

// Mumbai centroid, and a radius covering the metropolitan region.
const MUMBAI_LAT = 19.076;
const MUMBAI_LNG = 72.8777;
const MUMBAI_RADIUS_KM = 70;

// Great-circle distance in km.
function distanceKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
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
  const inIndia = country === 'IN' || isDev;
  const cityMatch = MUMBAI_AREA.some((c) => cityLc.includes(c));

  // Coordinates decide it whenever the city name doesn't — an empty header, a
  // spelling the list lacks ("Bombay"), or a suburb reported in its own right
  // ("Borivali", "Andheri"), all of which are inside the radius anyway.
  const lat = Number.parseFloat(latitude);
  const lng = Number.parseFloat(longitude);
  const km = Number.isFinite(lat) && Number.isFinite(lng)
    ? distanceKm(lat, lng, MUMBAI_LAT, MUMBAI_LNG)
    : null;
  const nearMumbai = km !== null && km <= MUMBAI_RADIUS_KM;

  const mumbai = inIndia && (cityMatch || nearMumbai);

  return new Response(
    JSON.stringify({
      mumbai, city, region, country, latitude, longitude, timezone,
      km: km === null ? null : Math.round(km),
    }),
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
