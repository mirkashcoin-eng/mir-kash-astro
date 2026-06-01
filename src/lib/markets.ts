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
export const DEFAULT_MARKET: Market = 'india';
export const INTERNATIONAL_DEFAULT_MARKET: Market = 'us';

function getEnv(key: string): string {
  if (typeof process !== 'undefined' && process.env && process.env[key]) {
    return process.env[key] as string;
  }
  const meta = import.meta.env as Record<string, string | undefined>;
  return meta[key] ?? '';
}

export const MARKETS: Record<Market, MarketConfig> = {
  india: {
    market: 'india',
    urlPrefix: '',
    currency: 'INR',
    currencySymbol: '₹',
    locale: 'en-IN',
    hreflang: 'en-IN',
    countryName: 'India',
    flag: '🇮🇳',
    label: 'India (₹)',
    shopifyDomain: getEnv('SHOPIFY_IN_DOMAIN'),
    shopifyToken: getEnv('SHOPIFY_IN_TOKEN'),
  },
  us: {
    market: 'us',
    urlPrefix: '/en-us',
    currency: 'USD',
    currencySymbol: '$',
    locale: 'en-US',
    hreflang: 'en-US',
    countryName: 'United States',
    flag: '🇺🇸',
    label: 'United States ($)',
    shopifyDomain: getEnv('SHOPIFY_GLOBAL_DOMAIN'),
    shopifyToken: getEnv('SHOPIFY_GLOBAL_TOKEN'),
  },
};

export const COUNTRY_TO_MARKET: Record<string, Market> = {
  IN: 'india',
};

export function getMarketFromCountry(country: string): Market {
  return COUNTRY_TO_MARKET[country] ?? INTERNATIONAL_DEFAULT_MARKET;
}

export interface Country {
  code: string;
  name: string;
  flag: string;
  market: Market;
  // Real local currency symbol — shown in the selector for context only.
  // Checkout still charges in the market currency (INR for India, USD globally).
  currency: string;
}

// India ships from the India store (INR); every other country resolves to the
// global store (USD). Alphabetical by name.
export const COUNTRIES: Country[] = [
  { code: 'AU', name: 'Australia', flag: '🇦🇺', market: 'us', currency: 'A$' },
  { code: 'AT', name: 'Austria', flag: '🇦🇹', market: 'us', currency: '€' },
  { code: 'BE', name: 'Belgium', flag: '🇧🇪', market: 'us', currency: '€' },
  { code: 'BR', name: 'Brazil', flag: '🇧🇷', market: 'us', currency: 'R$' },
  { code: 'CA', name: 'Canada', flag: '🇨🇦', market: 'us', currency: 'C$' },
  { code: 'CN', name: 'China', flag: '🇨🇳', market: 'us', currency: '¥' },
  { code: 'DK', name: 'Denmark', flag: '🇩🇰', market: 'us', currency: 'kr' },
  { code: 'EG', name: 'Egypt', flag: '🇪🇬', market: 'us', currency: 'E£' },
  { code: 'FI', name: 'Finland', flag: '🇫🇮', market: 'us', currency: '€' },
  { code: 'FR', name: 'France', flag: '🇫🇷', market: 'us', currency: '€' },
  { code: 'DE', name: 'Germany', flag: '🇩🇪', market: 'us', currency: '€' },
  { code: 'GR', name: 'Greece', flag: '🇬🇷', market: 'us', currency: '€' },
  { code: 'HK', name: 'Hong Kong', flag: '🇭🇰', market: 'us', currency: 'HK$' },
  { code: 'IN', name: 'India', flag: '🇮🇳', market: 'india', currency: '₹' },
  { code: 'ID', name: 'Indonesia', flag: '🇮🇩', market: 'us', currency: 'Rp' },
  { code: 'IE', name: 'Ireland', flag: '🇮🇪', market: 'us', currency: '€' },
  { code: 'IL', name: 'Israel', flag: '🇮🇱', market: 'us', currency: '₪' },
  { code: 'IT', name: 'Italy', flag: '🇮🇹', market: 'us', currency: '€' },
  { code: 'JP', name: 'Japan', flag: '🇯🇵', market: 'us', currency: '¥' },
  { code: 'MY', name: 'Malaysia', flag: '🇲🇾', market: 'us', currency: 'RM' },
  { code: 'MX', name: 'Mexico', flag: '🇲🇽', market: 'us', currency: 'Mex$' },
  { code: 'NL', name: 'Netherlands', flag: '🇳🇱', market: 'us', currency: '€' },
  { code: 'NZ', name: 'New Zealand', flag: '🇳🇿', market: 'us', currency: 'NZ$' },
  { code: 'NO', name: 'Norway', flag: '🇳🇴', market: 'us', currency: 'kr' },
  { code: 'PH', name: 'Philippines', flag: '🇵🇭', market: 'us', currency: '₱' },
  { code: 'PL', name: 'Poland', flag: '🇵🇱', market: 'us', currency: 'zł' },
  { code: 'PT', name: 'Portugal', flag: '🇵🇹', market: 'us', currency: '€' },
  { code: 'QA', name: 'Qatar', flag: '🇶🇦', market: 'us', currency: 'QR' },
  { code: 'SA', name: 'Saudi Arabia', flag: '🇸🇦', market: 'us', currency: 'SR' },
  { code: 'SG', name: 'Singapore', flag: '🇸🇬', market: 'us', currency: 'S$' },
  { code: 'ZA', name: 'South Africa', flag: '🇿🇦', market: 'us', currency: 'R' },
  { code: 'KR', name: 'South Korea', flag: '🇰🇷', market: 'us', currency: '₩' },
  { code: 'ES', name: 'Spain', flag: '🇪🇸', market: 'us', currency: '€' },
  { code: 'SE', name: 'Sweden', flag: '🇸🇪', market: 'us', currency: 'kr' },
  { code: 'CH', name: 'Switzerland', flag: '🇨🇭', market: 'us', currency: 'CHF' },
  { code: 'TW', name: 'Taiwan', flag: '🇹🇼', market: 'us', currency: 'NT$' },
  { code: 'TH', name: 'Thailand', flag: '🇹🇭', market: 'us', currency: '฿' },
  { code: 'AE', name: 'United Arab Emirates', flag: '🇦🇪', market: 'us', currency: 'AED' },
  { code: 'GB', name: 'United Kingdom', flag: '🇬🇧', market: 'us', currency: '£' },
  { code: 'US', name: 'United States', flag: '🇺🇸', market: 'us', currency: '$' },
  { code: 'VN', name: 'Vietnam', flag: '🇻🇳', market: 'us', currency: '₫' },
];

export function getCountryByCode(code: string): Country | undefined {
  return COUNTRIES.find((c) => c.code === code.toUpperCase());
}

// Default country shown per market when no explicit country choice is stored.
export const MARKET_DEFAULT_COUNTRY: Record<Market, string> = {
  india: 'IN',
  us: 'US',
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
