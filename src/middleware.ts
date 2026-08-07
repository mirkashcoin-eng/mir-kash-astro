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

// Crawlers worth naming, so /admin can show how often AI search reads the site
// rather than lumping them under a single "bot" bucket. Order matters: the first
// match wins, so put specific names before generic ones.
const NAMED_BOTS: Array<[RegExp, string]> = [
  [/GPTBot/i, 'ChatGPT'],
  [/OAI-SearchBot|ChatGPT-User/i, 'ChatGPT Search'],
  [/PerplexityBot|Perplexity-User/i, 'Perplexity'],
  [/ClaudeBot|Claude-User|anthropic-ai/i, 'Claude'],
  [/Google-Extended/i, 'Google AI'],
  [/Googlebot/i, 'Googlebot'],
  [/bingbot|BingPreview/i, 'Bingbot'],
  [/Applebot/i, 'Applebot'],
  [/facebookexternalhit|meta-externalagent/i, 'Facebook'],
  [/Bytespider/i, 'Bytespider'],
];

// The crawler's name, or '' for an ordinary visitor.
export function botName(ua: string): string {
  for (const [re, name] of NAMED_BOTS) if (re.test(ua)) return name;
  return BOT_UA.test(ua) ? 'Other bot' : '';
}
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

  // Visitor context from the request itself. The Referer header is only useful on
  // the first hit — after that it's our own domain — so same-origin is dropped here
  // rather than in the page. Set before the skip below, so bots are still labelled.
  const ua = request.headers.get('user-agent') ?? '';
  const ref = request.headers.get('referer') ?? '';
  let offsite = '';
  try {
    // Must be a real http(s) origin: `javascript:` and friends parse cleanly but
    // have no host, so a bare `!== url.host` check would let them through.
    const r = new URL(ref);
    if (/^https?:$/.test(r.protocol) && r.host && r.host !== url.host) offsite = ref;
  } catch { /* malformed or absent Referer — treat as absent */ }
  context.locals.botName = botName(ua);
  context.locals.referrer = offsite;
  context.locals.country = readCountry(request);

  if (shouldSkip(pathname, ua)) {
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
