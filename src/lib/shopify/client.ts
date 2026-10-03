import { createStorefrontApiClient, type StorefrontApiClient } from '@shopify/storefront-api-client';
import { STORE_CREDS } from '~/lib/markets';
import type { Store } from '~/types/market';

const API_VERSION = '2025-01';

const clientCache = new Map<string, StorefrontApiClient>();

export function getClient(store: Store): StorefrontApiClient | null {
  const cfg = STORE_CREDS[store];
  if (!cfg.shopifyDomain || !cfg.shopifyToken) return null;

  const key = `${cfg.shopifyDomain}::${cfg.shopifyToken}`;
  const cached = clientCache.get(key);
  if (cached) return cached;

  // A private Storefront token (shpat_…) is rejected with a 401 when sent as a
  // public one, and vice versa — send each in its own header. This module only
  // runs on the server, so a private token never reaches the browser.
  const isPrivate = cfg.shopifyToken.startsWith('shpat_');
  const client = createStorefrontApiClient({
    storeDomain: cfg.shopifyDomain,
    apiVersion: API_VERSION,
    ...(isPrivate ? { privateAccessToken: cfg.shopifyToken } : { publicAccessToken: cfg.shopifyToken }),
  });
  clientCache.set(key, client);
  return client;
}

// Pass `country` only for queries that declare @inContext(country/language).
export async function runQuery<T>(
  store: Store,
  query: string,
  variables: Record<string, unknown> = {},
  country?: string,
): Promise<T | null> {
  const client = getClient(store);
  if (!client) {
    console.warn(`[shopify] No credentials for store="${store}" — returning null.`);
    return null;
  }

  const vars = country ? { ...variables, country, language: 'EN' } : variables;

  try {
    const { data, errors } = await client.request<T>(query, { variables: vars });
    if (errors) {
      console.error(`[shopify] GraphQL errors for store="${store}":`, errors);
      return null;
    }
    return data ?? null;
  } catch (err) {
    console.error(`[shopify] Request failed for store="${store}":`, err);
    return null;
  }
}
