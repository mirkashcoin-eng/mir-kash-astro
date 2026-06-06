import { defineMiddleware } from 'astro:middleware';
import {
  MARKET_COOKIE,
  INDIA_MARKET,
  getMarketByPath,
  getMarketBySlug,
  getMarketByCountry,
  parseLocaleFromPath,
  getAlternateUrl,
} from '~/lib/markets';

const BOT_UA = /bot|crawl|spider|googlebot|bingbot|facebookexternalhit|slurp|duckduckbot/i;
const SKIP_PATHS = [/^\/api\//, /^\/_astro\//, /^\/_image/, /^\/favicon/, /^\/sitemap/, /^\/robots\.txt$/];

function shouldSkip(pathname: string, ua: string): boolean {
  if (BOT_UA.test(ua)) return true;
  if (pathname.includes('.')) return true; // static asset
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

  // Legacy India URLs (/en-in/*) now live at the root.
  if (pathname === '/en-in' || pathname.startsWith('/en-in/')) {
    return redirect(pathname.replace(/^\/en-in/, '') || '/', 301);
  }

  // Resolve the active market from the URL prefix (defaults to India at root).
  const market = getMarketByPath(pathname);
  context.locals.market = market.store;
  context.locals.marketConfig = market;

  if (shouldSkip(pathname, request.headers.get('user-agent') ?? '')) {
    return next();
  }

  // If the URL already carries a locale, respect it (no redirect).
  if (parseLocaleFromPath(pathname)) return next();

  // We're at the root (India context). A manual choice wins.
  const saved = cookies.get(MARKET_COOKIE)?.value;
  if (saved != null) {
    const chosen = getMarketBySlug(saved) ?? (saved === '' ? INDIA_MARKET : undefined);
    if (chosen && !chosen.isDefault) {
      return redirect(getAlternateUrl(pathname, chosen), 302);
    }
    return next(); // saved is India → stay at root
  }

  // No manual choice: auto-route by geo.
  const country = readCountry(request);
  if (country) {
    const geoMarket = getMarketByCountry(country);
    if (!geoMarket.isDefault) {
      return redirect(getAlternateUrl(pathname, geoMarket), 302);
    }
  }

  return next();
});
