// Shipping + returns terms: published as schema.org markup on every product page, shown on the page (trust line,
// delivery estimate, FAQ) and mirrored in Shopify shipping settings + Google Merchant Center.
//
// Google disapproves products when Merchant Center, the feed and the storefront disagree, so this file is the single
// source of truth in code. Human-readable version: brand-wiki/SHIPPING-RETURNS-POLICY.md (approved 29 Sep 2026).
// Change a number here → change it in Shopify (Settings → Shipping and delivery) and in that doc too.
import type { Store } from '~/types/market';

/** Return window in days from delivery, per store (India 7, Global 15; decided 29 Sep 2026). */
export const RETURN_DAYS: Record<Store, number> = { india: 7, global: 15 };
export const returnDaysFor = (countryCode: string) => RETURN_DAYS[countryCode.toUpperCase() === 'IN' ? 'india' : 'global'];

export interface ShippingTerms {
  /** Business days from order to dispatch: [min, max]. */
  handlingDays: [number, number];
  /** Business days in transit: [min, max]. */
  transitDays: [number, number];
  /** Shipping charged to the buyer (0 = free), in `currency`. Paid Global rates are set in USD; Shopify converts. */
  cost: number;
  currency: 'INR' | 'USD';
  /** Duties and import taxes are included in the price (Mir Kash pays them). */
  dutiesIncluded: boolean;
  zone: string;
}

export interface ReturnOffice { city: string; address: string }
export const RETURN_OFFICES: Record<'mumbai' | 'hongkong', ReturnOffice> = {
  mumbai: { city: 'Mumbai', address: 'Jaywant Industrial Estate, Tardeo, Mumbai 400034' },
  hongkong: { city: 'Hong Kong', address: 'Guardforce Centre, 03 Hok Yuen Street, Hung Hom, Hong Kong' },
};

// India ships from India. Every other country is the Global store, shipping from Hong Kong by tracked express.
const INDIA: ShippingTerms = { zone: 'India', handlingDays: [1, 2], transitDays: [6, 8], cost: 0, currency: 'INR', dutiesIncluded: true };
const zone = (name: string, cost: number, transit: [number, number]): ShippingTerms =>
  ({ zone: name, handlingDays: [1, 3], transitDays: transit, cost, currency: 'USD', dutiesIncluded: true });
const ZONES = {
  HK: zone('Hong Kong', 0, [1, 2]),
  APAC: zone('Asia-Pacific', 20, [2, 4]),
  NA: zone('North America', 30, [3, 5]),
  EU: zone('UK & Europe', 30, [3, 5]),
  ME: zone('Middle East', 30, [3, 5]),
  ROW: zone('Rest of world', 40, [4, 7]),
};
/** Global zones in rate order, for the Shipping & Returns page. */
export const GLOBAL_ZONES: ShippingTerms[] = Object.values(ZONES);
const COUNTRY_ZONE: Record<string, keyof typeof ZONES> = {
  HK: 'HK',
  SG: 'APAC', JP: 'APAC', KR: 'APAC', CN: 'APAC', TW: 'APAC', MY: 'APAC', TH: 'APAC', ID: 'APAC', PH: 'APAC', AU: 'APAC', NZ: 'APAC',
  US: 'NA', CA: 'NA',
  AE: 'ME', SA: 'ME', KW: 'ME', QA: 'ME', BH: 'ME', OM: 'ME', IL: 'ME', TR: 'ME',
  ZA: 'ROW', NG: 'ROW', KE: 'ROW', BR: 'ROW', MX: 'ROW', CL: 'ROW', CO: 'ROW',
};
const EUROPE = new Set(['GB', 'DE', 'FR', 'IT', 'ES', 'NL', 'IE', 'AT', 'BE', 'PT', 'GR', 'FI', 'LU', 'SK', 'SI', 'EE', 'LV', 'LT', 'CY', 'MT', 'HR', 'PL', 'CZ', 'CH', 'SE', 'NO', 'DK', 'IS']);

/** Shipping terms for one country (ISO code). Unknown global countries fall into "Rest of world". */
export function shippingFor(countryCode: string): ShippingTerms {
  const cc = countryCode.toUpperCase();
  if (cc === 'IN') return INDIA;
  if (EUROPE.has(cc)) return ZONES.EU;
  return ZONES[COUNTRY_ZONE[cc] ?? 'ROW'];
}

/** Where a customer in this country sends a return: India → Mumbai, every Global country → Hong Kong (29 Sep 2026). */
export function returnOfficeFor(countryCode: string): ReturnOffice {
  const cc = countryCode.toUpperCase();
  return cc === 'IN' ? RETURN_OFFICES.mumbai : RETURN_OFFICES.hongkong;
}

/** Sizes are shown in inches as well as cm here. */
export const usesInches = (countryCode: string) => countryCode.toUpperCase() === 'US';

/** Latest likely delivery date: order today → dispatch + transit, counting business days only (upper end of both ranges). */
export function deliveryBy(terms: ShippingTerms, from: Date = new Date()): Date {
  const d = new Date(from);
  let left = terms.handlingDays[1] + terms.transitDays[1];
  while (left > 0) {
    d.setDate(d.getDate() + 1);
    const day = d.getDay();
    if (day !== 0 && day !== 6) left--;
  }
  return d;
}

// Kept for older imports: per-store defaults (Global = its most common zone).
export const SHIPPING: Record<Store, ShippingTerms> = { india: INDIA, global: ZONES.NA };
