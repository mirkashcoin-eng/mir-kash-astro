import type { Market, MarketConfig } from '~/types/market';
import type { Money } from '~/types/shopify';

const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: '$',
  INR: '₹',
  EUR: '€',
  GBP: '£',
  AED: 'د.إ',
};

export const SITE_ORIGIN = 'https://mirkash.com';
export const MARKET_COOKIE = 'mirkash-market';
export const MARKET_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;
export const DEFAULT_MARKET: Market = 'global';

export const MARKETS: Record<Market, MarketConfig> = {
  global: {
    market: 'global',
    urlPrefix: '',
    currency: 'USD',
    currencySymbol: '$',
    locale: 'en',
    hreflang: 'en',
    countryName: 'Global',
    flag: '🌍',
    label: 'Global (USD)',
    shopifyDomain: import.meta.env.SHOPIFY_GLOBAL_DOMAIN ?? '',
    shopifyToken: import.meta.env.SHOPIFY_GLOBAL_TOKEN ?? '',
  },
  india: {
    market: 'india',
    urlPrefix: '/en-in',
    currency: 'INR',
    currencySymbol: '₹',
    locale: 'en-IN',
    hreflang: 'en-IN',
    countryName: 'India',
    flag: '🇮🇳',
    label: 'India (₹)',
    shopifyDomain: import.meta.env.SHOPIFY_IN_DOMAIN ?? '',
    shopifyToken: import.meta.env.SHOPIFY_IN_TOKEN ?? '',
  },
};

export const COUNTRY_TO_MARKET: Record<string, Market> = {
  IN: 'india',
};

export function listMarkets(): MarketConfig[] {
  return Object.values(MARKETS);
}

export function getMarketFromUrl(pathname: string): Market {
  for (const cfg of listMarkets()) {
    if (!cfg.urlPrefix) continue;
    if (pathname === cfg.urlPrefix || pathname.startsWith(cfg.urlPrefix + '/')) {
      return cfg.market;
    }
  }
  return DEFAULT_MARKET;
}

export function stripMarketPrefix(pathname: string): string {
  for (const cfg of listMarkets()) {
    if (!cfg.urlPrefix) continue;
    if (pathname === cfg.urlPrefix) return '/';
    if (pathname.startsWith(cfg.urlPrefix + '/')) {
      return pathname.slice(cfg.urlPrefix.length);
    }
  }
  return pathname;
}

export function getAlternateUrl(pathname: string, target: Market): string {
  const stripped = stripMarketPrefix(pathname);
  const prefix = MARKETS[target].urlPrefix;
  if (!prefix) return stripped || '/';
  if (stripped === '/') return prefix;
  return prefix + stripped;
}

export function absoluteUrl(pathname: string): string {
  return SITE_ORIGIN + pathname;
}

export function formatMoney(money: Money, locale = 'en'): string {
  const symbol = CURRENCY_SYMBOLS[money.currencyCode] ?? money.currencyCode + ' ';
  const amount = Number(money.amount);
  const rounded = Number.isFinite(amount)
    ? Math.round(amount).toLocaleString(locale)
    : money.amount;
  return symbol + rounded;
}
