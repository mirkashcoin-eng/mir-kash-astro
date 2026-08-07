/// <reference path="../.astro/types.d.ts" />

import type { Market, MarketConfig } from './types/market';

declare global {
  namespace App {
    interface Locals {
      market: Market;
      marketConfig: MarketConfig;
      // Request-derived visitor context, stamped by middleware. Server-side, so it
      // survives blocked/failed client JS and can't be spoofed by the page.
      botName: string;   // '' for humans; 'ChatGPT', 'Googlebot', … for crawlers
      referrer: string;  // off-site Referer header only
      country: string;   // ISO code from the CDN edge
    }
  }
  interface Window {
    // First-party analytics + lead capture (defined inline in BaseLayout).
    mkTrack?: (event: string, opts?: { product?: string }) => void;
    mkSid?: string;
    mkLead?: (data: {
      event: 'add_to_cart' | 'phone' | 'address';
      item?: string; phone?: string; email?: string; name?: string; uid?: string;
      address1?: string; city?: string; province?: string; pin?: string;
      cart?: { total: number; currency: string; quantity: number; lines: Array<{ title: string; variant: string | null; quantity: number; price: number }> };
    }) => void;
    // Trims a Shopify cart payload down to what /admin stores.
    cartSnapshot?: (cart: unknown) => { total: number; currency: string; quantity: number; lines: Array<{ title: string; variant: string | null; quantity: number; price: number }> } | undefined;
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
  // Firebase — customer accounts (Google sign-in) + Firestore (profiles + leads)
  readonly PUBLIC_FIREBASE_API_KEY: string;
  readonly PUBLIC_FIREBASE_AUTH_DOMAIN: string;
  readonly PUBLIC_FIREBASE_PROJECT_ID: string;
  readonly PUBLIC_FIREBASE_APP_ID: string;
  // Founders' dashboard (/admin) — Google-email allowlist AND/OR a shared passcode
  readonly ADMIN_EMAILS: string;
  readonly ADMIN_PASSCODE: string;
  // Firebase Admin SDK service-account JSON — powers the /admin funnel + Leads.
  readonly FIREBASE_SERVICE_ACCOUNT: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

export {};
