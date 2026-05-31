export type Market = 'india' | 'us';

export interface MarketConfig {
  market: Market;
  urlPrefix: string;
  currency: string;
  currencySymbol: string;
  locale: string;
  hreflang: string;
  countryName: string;
  flag: string;
  label: string;
  shopifyDomain: string;
  shopifyToken: string;
}
