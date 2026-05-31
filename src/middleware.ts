import { defineMiddleware } from 'astro:middleware';
import {
  MARKETS,
  MARKET_COOKIE,
  getMarketFromUrl,
  getMarketFromCountry,
  getAlternateUrl,
} from '~/lib/markets';
import type { Market } from '~/types/market';

const BOT_UA = /bot|crawl|spider|googlebot|bingbot|facebookexternalhit|slurp|duckduckbot/i;
const SKIP_PATHS = [/^\/api\//, /^\/_astro\//, /^\/_image/, /^\/favicon/, /^\/sitemap/, /^\/robots\.txt$/];

function shouldSkipGeoLogic(pathname: string, ua: string): boolean {
  if (BOT_UA.test(ua)) return true;
  return SKIP_PATHS.some((re) => re.test(pathname));
}

function readCountry(request: Request): string {
  return (
    request.headers.get('x-vercel-ip-country') ??
    request.headers.get('cf-ipcountry') ??
    ''
  ).toUpperCase();
}

export const onRequest = defineMiddleware(async (context, next) => {
  const { request, url, cookies, redirect } = context;
  const pathname = url.pathname;

  // Legacy India URLs (/en-in/*) now live at the root — permanently redirect.
  if (pathname === '/en-in' || pathname.startsWith('/en-in/')) {
    return redirect(pathname.replace(/^\/en-in/, '') || '/', 301);
  }

  const market: Market = getMarketFromUrl(pathname);
  context.locals.market = market;
  context.locals.marketConfig = MARKETS[market];

  const overrideRaw = cookies.get(MARKET_COOKIE)?.value;
  const override =
    overrideRaw && (overrideRaw === 'india' || overrideRaw === 'us')
      ? (overrideRaw as Market)
      : null;

  if (shouldSkipGeoLogic(pathname, request.headers.get('user-agent') ?? '')) {
    return next();
  }

  // A manual market choice always wins and suppresses the geo redirect.
  if (override) {
    if (override !== market) {
      return redirect(getAlternateUrl(pathname, override), 302);
    }
    return next();
  }

  // No manual choice: auto-route non-India visitors to their market.
  // India visitors at the root resolve to india === india → no redirect (fast path).
  const country = readCountry(request);
  if (country) {
    const geoMarket = getMarketFromCountry(country);
    if (geoMarket !== market) {
      return redirect(getAlternateUrl(pathname, geoMarket), 302);
    }
  }

  return next();
});
