// Small pure helpers for the product page and its JSON-LD. Page structure: brand-wiki/PRODUCT-PAGE-STRUCTURE.md;
// shipping facts: src/lib/merchant-policy.ts; country-page rules: brand-wiki/LOCAL-MARKET-PAGES.md.
import type { MarketConfig } from '~/types/market';
import type { ProductDetail } from '~/types/shopify';
import { CATEGORIES } from '~/lib/categories';
import { deliveryBy, returnDaysFor, returnOfficeFor, shippingFor, usesInches } from '~/lib/merchant-policy';

export type FaqItem = { q: string; a: string };

const readJson = <T,>(raw: string | undefined | null): T[] => {
  try {
    const v = JSON.parse(raw ?? '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
};

/** Which shop category a bag belongs to (same productType rule as the category pages). */
export function categoryOf(productType: string): { name: string; slug: string } | undefined {
  const c = CATEGORIES.find((x) => x.match.test(productType || ''));
  return c ? { name: c.title, slug: c.slug } : undefined;
}

/** "H 16 × L 18 × W 6 cm" → "H 16 × L 18 × W 6 cm (H 6.3 × L 7.1 × W 2.4 in)" — only where the market uses inches. */
export function dimensionsFor(dims: string, market: MarketConfig): string {
  if (!dims || !usesInches(market.countryCode) || !/cm/.test(dims)) return dims;
  const inch = dims.replace(/(\d+(?:\.\d+)?)/g, (n) => (Number(n) / 2.54).toFixed(1)).replace(/\bcm\b/g, 'in');
  return `${dims} (${inch})`;
}

/** The ways a bag is carried, for the chips under the price. Shopify's carry-options first; else read the bag's details. */
export function carryWays(product: ProductDetail, details: string[]): string[] {
  const refs = (product.carryOptions?.references?.nodes ?? []).map((n) => n.handle ?? '');
  const out = new Set<string>();
  if (/clutch/i.test(product.productType)) out.add('Clutch');
  if (refs.length) {
    for (const h of refs) {
      if (/^handle/.test(h)) out.add('Handheld');
      if (/shoulder/.test(h)) out.add('Shoulder');
      if (/crossbody/.test(h)) out.add('Crossbody');
    }
  } else {
    const txt = details.join(' ').toLowerCase();
    if (/handle/.test(txt)) out.add('Handheld');
    if (/shoulder|chain strap/.test(txt) || /shoulder/i.test(product.productType)) out.add('Shoulder');
    if (/crossbody|long strap/.test(txt)) out.add('Crossbody');
  }
  const order = ['Clutch', 'Handheld', 'Shoulder', 'Crossbody'];
  return order.filter((w) => out.has(w));
}

const fmtDate = (d: Date, market: MarketConfig) =>
  new Intl.DateTimeFormat(market.locale, { weekday: 'short', day: 'numeric', month: 'short' }).format(d);

/** One true, country-specific line under Add to bag (brand-wiki/LOCAL-MARKET-PAGES.md). */
export function trustLine(market: MarketConfig): string[] {
  const s = shippingFor(market.countryCode);
  const returns = `${returnDaysFor(market.countryCode)}-day returns`;
  if (market.countryCode === 'IN') return ['Free shipping across India', '1-year warranty', returns];
  const days = `${s.handlingDays[0] + s.transitDays[0]}–${s.handlingDays[1] + s.transitDays[1]} business days`;
  const where = market.countryCode === 'US' ? 'the US' : market.countryCode === 'GB' ? 'the UK' : market.countryName;
  return [
    s.cost === 0 ? `Free delivery in ${where}` : `Delivered to ${where} in ${days}`,
    'Duties & taxes included',
    returns,
  ];
}

/** "Order today, arrives by Thu, 9 Oct" + where returns go. */
export function deliveryLines(market: MarketConfig, now = new Date()): { arrives: string; returns: string } {
  const s = shippingFor(market.countryCode);
  const office = returnOfficeFor(market.countryCode);
  return {
    arrives: `Order today, arrives by ${fmtDate(deliveryBy(s, now), market)}`,
    returns: `Returns go to our ${office.city} office`,
  };
}

/** The bag's own FAQ (custom.faq). (The per-country customs question was removed on 29 Sep.) */
export function faqFor(product: ProductDetail, _market?: MarketConfig): FaqItem[] {
  return readJson<FaqItem>(product.faq?.value).filter((f) => f && f.q && f.a);
}
