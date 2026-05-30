/// <reference path="../.astro/types.d.ts" />

import type { Market, MarketConfig } from './types/market';

declare global {
  namespace App {
    interface Locals {
      market: Market;
      marketConfig: MarketConfig;
    }
  }
}

interface ImportMetaEnv {
  readonly SHOPIFY_GLOBAL_DOMAIN: string;
  readonly SHOPIFY_GLOBAL_TOKEN: string;
  readonly SHOPIFY_IN_DOMAIN: string;
  readonly SHOPIFY_IN_TOKEN: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

export {};
