import type { Store, Market, MarketConfig } from '~/types/market';
import type { Money } from '~/types/shopify';

export const SITE_ORIGIN = 'https://mirkash.com';
export const MARKET_COOKIE = 'market_locale';       // stores the chosen localeSlug ('' for India)
export const MARKET_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

function getEnv(key: string): string {
  if (typeof process !== 'undefined' && process.env && process.env[key]) {
    return process.env[key] as string;
  }
  const meta = import.meta.env as Record<string, string | undefined>;
  return meta[key] ?? '';
}

// ── Shopify stores (domain + Storefront token per store) ──────────────────────
export const STORE_CREDS: Record<Store, { shopifyDomain: string; shopifyToken: string }> = {
  india: { shopifyDomain: getEnv('SHOPIFY_IN_DOMAIN'), shopifyToken: getEnv('SHOPIFY_IN_TOKEN') },
  global: { shopifyDomain: getEnv('SHOPIFY_GLOBAL_DOMAIN'), shopifyToken: getEnv('SHOPIFY_GLOBAL_TOKEN') },
};

// ── Markets (one per country we serve) ────────────────────────────────────────
// India is the default (served at root, INR, India store). Everything else is the
// global store with its local currency via Storefront @inContext.
type Row = [country: string, name: string, currency: string, symbol: string, flag: string];

const GLOBAL_ROWS: Row[] = [
  ['US', 'United States', 'USD', '$', '🇺🇸'],
  ['GB', 'United Kingdom', 'GBP', '£', '🇬🇧'],
  ['AE', 'United Arab Emirates', 'AED', 'د.إ', '🇦🇪'],
  ['AU', 'Australia', 'AUD', 'A$', '🇦🇺'],
  ['CA', 'Canada', 'CAD', 'C$', '🇨🇦'],
  ['SG', 'Singapore', 'SGD', 'S$', '🇸🇬'],
  ['HK', 'Hong Kong', 'HKD', 'HK$', '🇭🇰'],
  ['DE', 'Germany', 'EUR', '€', '🇩🇪'],
  ['FR', 'France', 'EUR', '€', '🇫🇷'],
  ['IT', 'Italy', 'EUR', '€', '🇮🇹'],
  ['ES', 'Spain', 'EUR', '€', '🇪🇸'],
  ['NL', 'Netherlands', 'EUR', '€', '🇳🇱'],
  ['IE', 'Ireland', 'EUR', '€', '🇮🇪'],
  ['CH', 'Switzerland', 'CHF', 'CHF', '🇨🇭'],
  ['SE', 'Sweden', 'SEK', 'kr', '🇸🇪'],
  ['NO', 'Norway', 'NOK', 'kr', '🇳🇴'],
  ['DK', 'Denmark', 'DKK', 'kr', '🇩🇰'],
  ['JP', 'Japan', 'JPY', '¥', '🇯🇵'],
  ['NZ', 'New Zealand', 'NZD', 'NZ$', '🇳🇿'],
  ['SA', 'Saudi Arabia', 'SAR', 'SR', '🇸🇦'],
  ['ZA', 'South Africa', 'ZAR', 'R', '🇿🇦'],
  // ── Additional markets ──────────────────────────────────────────────────────
  ['IS', 'Iceland', 'ISK', 'kr', '🇮🇸'],
  ['PL', 'Poland', 'PLN', 'zł', '🇵🇱'],
  ['CZ', 'Czech Republic', 'CZK', 'Kč', '🇨🇿'],
  ['TR', 'Türkiye', 'TRY', '₺', '🇹🇷'],
  ['KW', 'Kuwait', 'KWD', 'KD', '🇰🇼'],
  ['QA', 'Qatar', 'QAR', 'QR', '🇶🇦'],
  ['BH', 'Bahrain', 'BHD', 'BD', '🇧🇭'],
  ['OM', 'Oman', 'OMR', 'OMR', '🇴🇲'],
  ['IL', 'Israel', 'ILS', '₪', '🇮🇱'],
  ['KR', 'South Korea', 'KRW', '₩', '🇰🇷'],
  ['CN', 'China', 'CNY', '¥', '🇨🇳'],
  ['TW', 'Taiwan', 'TWD', 'NT$', '🇹🇼'],
  ['MY', 'Malaysia', 'MYR', 'RM', '🇲🇾'],
  ['TH', 'Thailand', 'THB', '฿', '🇹🇭'],
  ['ID', 'Indonesia', 'IDR', 'Rp', '🇮🇩'],
  ['PH', 'Philippines', 'PHP', '₱', '🇵🇭'],
  ['BR', 'Brazil', 'BRL', 'R$', '🇧🇷'],
  ['MX', 'Mexico', 'MXN', 'MX$', '🇲🇽'],
  ['CL', 'Chile', 'CLP', 'CL$', '🇨🇱'],
  ['CO', 'Colombia', 'COP', 'COL$', '🇨🇴'],
  ['NG', 'Nigeria', 'NGN', '₦', '🇳🇬'],
  ['KE', 'Kenya', 'KES', 'KSh', '🇰🇪'],
];

export const INDIA_MARKET: MarketConfig = {
  store: 'india',
  localeSlug: '',
  urlPrefix: '',
  countryCode: 'IN',
  currency: 'INR',
  currencySymbol: '₹',
  locale: 'en-IN',
  hreflang: 'en-IN',
  countryName: 'India',
  flag: '🇮🇳',
  isDefault: true,
};

export const MARKETS: MarketConfig[] = [
  INDIA_MARKET,
  ...GLOBAL_ROWS.map(([country, name, currency, symbol, flag]) => ({
    store: 'global' as Store,
    localeSlug: `en-${country.toLowerCase()}`,
    urlPrefix: `/en-${country.toLowerCase()}`,
    countryCode: country,
    currency,
    currencySymbol: symbol,
    locale: `en-${country}`,
    hreflang: `en-${country}`,
    countryName: name,
    flag,
  })),
];

export const DEFAULT_MARKET = INDIA_MARKET;

export function listMarkets(): MarketConfig[] {
  return MARKETS;
}

// ── Lookups ───────────────────────────────────────────────────────────────────
export function getMarketBySlug(slug: string): MarketConfig | undefined {
  return MARKETS.find((m) => m.localeSlug === slug);
}

export function getMarketByCountry(country: string): MarketConfig {
  const cc = (country || '').toUpperCase();
  if (cc === 'IN') return INDIA_MARKET;
  return MARKETS.find((m) => m.countryCode === cc) ?? getMarketBySlug('en-us')!;
}

// Returns the locale slug present in a path ('en-gb') or null.
export function parseLocaleFromPath(pathname: string): string | null {
  const m = pathname.match(/^\/(en-[a-z]{2})(?:\/|$)/);
  return m ? m[1] : null;
}

export function getMarketByPath(pathname: string): MarketConfig {
  const slug = parseLocaleFromPath(pathname);
  return (slug && getMarketBySlug(slug)) || INDIA_MARKET;
}

// Path for a market's home, e.g. '/en-gb' or '/'.
export function getMarketPath(m: MarketConfig): string {
  return m.urlPrefix || '/';
}

// Strip any locale prefix → bare path ('/products/bag').
export function stripMarketPrefix(pathname: string): string {
  const slug = parseLocaleFromPath(pathname);
  if (!slug) return pathname;
  const stripped = pathname.slice(`/${slug}`.length);
  return stripped || '/';
}

// Same page, different market.
export function getAlternateUrl(pathname: string, target: MarketConfig): string {
  const bare = stripMarketPrefix(pathname);
  if (!target.urlPrefix) return bare || '/';
  return bare === '/' ? target.urlPrefix : target.urlPrefix + bare;
}

export function absoluteUrl(pathname: string): string {
  return SITE_ORIGIN + pathname;
}

// ── Money formatting ──────────────────────────────────────────────────────────
const SYMBOLS: Record<string, string> = {
  USD: '$', INR: '₹', EUR: '€', GBP: '£', AED: 'د.إ', AUD: 'A$', CAD: 'C$',
  SGD: 'S$', HKD: 'HK$', CHF: 'CHF', SEK: 'kr', NOK: 'kr', DKK: 'kr',
  JPY: '¥', NZD: 'NZ$', SAR: 'SR', ZAR: 'R',
};

// Always format in a fixed English locale so every currency is unambiguous
// (USD "$", AUD "A$", CAD "CA$", SGD "SGD", CHF "CHF", ¥/CN¥, £, €, ₹ …) and
// consistent across markets — never a bare "$" for a non-USD currency.
const DISPLAY_LOCALE = 'en-US';

export function formatPrice(amount: string | number, currencyCode: string): string {
  const value = typeof amount === 'string' ? parseFloat(amount) : amount;
  if (!Number.isFinite(value)) return String(amount);
  try {
    return new Intl.NumberFormat(DISPLAY_LOCALE, {
      style: 'currency',
      currency: currencyCode || 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value);
  } catch {
    const sym = SYMBOLS[currencyCode] ?? currencyCode + ' ';
    return sym + Math.round(value).toLocaleString(DISPLAY_LOCALE);
  }
}

// Back-compat: existing callers use formatMoney(money, locale). The locale arg is
// ignored now — we always format in a fixed locale for unambiguous symbols.
export function formatMoney(money: Money, _locale?: string): string {
  return formatPrice(money.amount, money.currencyCode);
}

export type { Store, Market, MarketConfig };
