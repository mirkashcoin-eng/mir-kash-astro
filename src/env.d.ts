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
  // India custom checkout
  readonly SHOPIFY_IN_ADMIN_DOMAIN: string;
  readonly SHOPIFY_IN_ADMIN_CLIENT_ID: string;
  readonly SHOPIFY_IN_ADMIN_CLIENT_SECRET: string;
  readonly CASHFREE_APP_ID: string;
  readonly CASHFREE_SECRET_KEY: string;
  readonly CASHFREE_ENV: string;
  readonly PUBLIC_CASHFREE_MODE: string;
  readonly PUBLIC_FIREBASE_API_KEY: string;
  readonly PUBLIC_FIREBASE_AUTH_DOMAIN: string;
  readonly PUBLIC_FIREBASE_PROJECT_ID: string;
  readonly PUBLIC_FIREBASE_APP_ID: string;
  // Firestore lead capture (server-side service account, full JSON)
  readonly FIREBASE_SERVICE_ACCOUNT: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

export {};
