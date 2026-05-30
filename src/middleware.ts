import { defineMiddleware } from 'astro:middleware';
import {
  MARKETS,
  MARKET_COOKIE,
  MARKET_COOKIE_MAX_AGE,
  COUNTRY_TO_MARKET,
  getMarketFromUrl,
  getAlternateUrl,
} from '~/lib/markets';
import type { Market } from '~/types/market';

export const GEO_SUGGESTION_COOKIE = 'mirkash-geo-suggestion';
export const GEO_DISMISSED_COOKIE = 'mirkash-geo-dismissed';

const BOT_UA = /bot|crawl|spider|googlebot|bingbot|facebookexternalhit|slurp|duckduckbot/i;
const SKIP_PATHS = [/^\/api\//, /^\/_astro\//, /^\/_image/, /^\/favicon/, /^\/sitemap/, /^\/robots\.txt$/];

function shouldSkipBannerLogic(pathname: string, ua: string): boolean {
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
  const market: Market = getMarketFromUrl(pathname);
  const marketConfig = MARKETS[market];

  context.locals.market = market;
  context.locals.marketConfig = marketConfig;

  const overrideRaw = cookies.get(MARKET_COOKIE)?.value;
  const override =
    overrideRaw && (overrideRaw === 'global' || overrideRaw === 'india')
      ? (overrideRaw as Market)
      : null;

  if (override && override !== market) {
    if (!shouldSkipBannerLogic(pathname, request.headers.get('user-agent') ?? '')) {
      return redirect(getAlternateUrl(pathname, override), 302);
    }
  }

  if (!shouldSkipBannerLogic(pathname, request.headers.get('user-agent') ?? '')) {
    const country = readCountry(request);
    const geoSuggestion: Market | null = country ? COUNTRY_TO_MARKET[country] ?? null : null;
    const dismissed = cookies.get(GEO_DISMISSED_COOKIE)?.value === '1';

    if (geoSuggestion && geoSuggestion !== market && !override && !dismissed) {
      cookies.set(GEO_SUGGESTION_COOKIE, geoSuggestion, {
        path: '/',
        maxAge: 60 * 60,
        sameSite: 'lax',
      });
    } else {
      cookies.delete(GEO_SUGGESTION_COOKIE, { path: '/' });
    }
  }

  return next();
});
