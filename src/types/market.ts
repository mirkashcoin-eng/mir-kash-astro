// A "store" is one of the two Shopify stores we talk to (different domains/tokens).
export type Store = 'india' | 'global';

// Back-compat alias: older code refers to `Market` as the store identifier.
export type Market = Store;

// A market/locale = one country we serve, mapped to a store + URL prefix + currency.
export interface MarketConfig {
  store: Store;          // which Shopify store/token to use
  localeSlug: string;    // '' for India (default), else 'en-gb', 'en-fr', …
  urlPrefix: string;     // '' for India, else '/en-gb'
  countryCode: string;   // ISO country for Storefront @inContext + buyerIdentity, e.g. 'IN','GB'
  currency: string;      // ISO currency code, e.g. 'INR','GBP' (Shopify is source of truth for prices)
  currencySymbol: string;
  locale: string;        // BCP47 for Intl number formatting, e.g. 'en-IN'
  hreflang: string;
  countryName: string;
  flag: string;
  isDefault?: boolean;
}
