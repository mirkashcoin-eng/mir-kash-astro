// schema.org JSON-LD for a product page: a ProductGroup (the bag) with one Product per colour.
// This is what Google reads on a headless storefront for merchant listings (price, availability,
// colour, shipping, returns) — Shopify's own theme markup never reaches these pages.
import type { MarketConfig } from '~/types/market';
import type { ProductDetail } from '~/types/shopify';
import { SITE_ORIGIN } from '~/lib/markets';
import { returnDaysFor, shippingFor } from '~/lib/merchant-policy';

const numericId = (gid: string) => gid.split('/').pop() ?? gid;

export function productJsonLd(product: ProductDetail, market: MarketConfig, canonical: string, description: string) {
  const images = (product.images?.edges ?? []).map((e) => e.node.url);
  if (!images.length && product.featuredImage) images.push(product.featuredImage.url);
  const ship = shippingFor(market.countryCode);
  const days = (r: [number, number]) => ({ '@type': 'QuantitativeValue', minValue: r[0], maxValue: r[1], unitCode: 'DAY' });

  const shippingDetails = {
    '@type': 'OfferShippingDetails',
    // Free → 0 in the shopper's currency. Paid Global rates are set in USD in Shopify (converted at checkout).
    shippingRate: { '@type': 'MonetaryAmount', value: ship.cost, currency: ship.cost === 0 ? market.currency : ship.currency },
    shippingDestination: { '@type': 'DefinedRegion', addressCountry: market.countryCode },
    deliveryTime: { '@type': 'ShippingDeliveryTime', handlingTime: days(ship.handlingDays), transitTime: days(ship.transitDays) },
  };
  // returnFees is left out on purpose: returns are customer-paid at an amount that depends on the courier, and
  // Google requires an amount whenever fees are declared. Set the fee in Merchant Center instead (it takes precedence).
  const returnPolicy = {
    '@type': 'MerchantReturnPolicy',
    applicableCountry: market.countryCode,
    returnPolicyCategory: 'https://schema.org/MerchantReturnFiniteReturnWindow',
    merchantReturnDays: returnDaysFor(market.countryCode),
    returnMethod: 'https://schema.org/ReturnByMail',
  };

  const colourOf = (v: ProductDetail['variants']['edges'][number]['node']) =>
    v.selectedOptions.find((o) => /colou?r/i.test(o.name))?.value;

  const variants = product.variants.edges.map((e) => e.node).map((v) => {
    const colour = colourOf(v);
    return {
      '@type': 'Product',
      name: colour ? `${product.title} – ${colour}` : product.title,
      sku: v.sku || numericId(v.id),
      mpn: v.sku || undefined,
      ...(colour ? { color: colour } : {}),
      image: v.image?.url ?? images[0],
      offers: {
        '@type': 'Offer',
        url: `${canonical}?variant=${numericId(v.id)}`,
        priceCurrency: v.price.currencyCode,
        price: v.price.amount,
        itemCondition: 'https://schema.org/NewCondition',
        availability: v.availableForSale ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
        seller: { '@type': 'Organization', name: 'Mir Kash' },
        shippingDetails,
        hasMerchantReturnPolicy: returnPolicy,
      },
    };
  });

  return {
    '@context': 'https://schema.org',
    '@type': 'ProductGroup',
    '@id': `${canonical}#product`,
    name: product.title,
    description,
    url: canonical,
    image: images,
    brand: { '@type': 'Brand', name: 'Mir Kash' },
    productGroupID: product.handle,
    ...(variants.some((v) => v.color) ? { variesBy: ['https://schema.org/color'] } : {}),
    hasVariant: variants,
  };
}

export const breadcrumbJsonLd = (product: ProductDetail, market: MarketConfig, category?: { name: string; slug: string }) => ({
  '@context': 'https://schema.org',
  '@type': 'BreadcrumbList',
  itemListElement: [
    { '@type': 'ListItem', position: 1, name: 'Shop All', item: `${SITE_ORIGIN}${market.urlPrefix}/shop` },
    ...(category ? [{ '@type': 'ListItem', position: 2, name: category.name, item: `${SITE_ORIGIN}${market.urlPrefix}/shop/${category.slug}` }] : []),
    { '@type': 'ListItem', position: category ? 3 : 2, name: product.title },
  ],
});

/** FAQPage markup from the same questions shown on the page (bag FAQ + the country's delivery question). */
export function faqJsonLd(items: Array<{ q: string; a: string }>) {
  if (!items.length) return null;
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: items.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })),
  };
}
