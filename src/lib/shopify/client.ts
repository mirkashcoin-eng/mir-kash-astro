import { createStorefrontApiClient, type StorefrontApiClient } from '@shopify/storefront-api-client';
import { MARKETS } from '~/lib/markets';
import type { Market } from '~/types/market';

const API_VERSION = '2025-01';

const clientCache = new Map<string, StorefrontApiClient>();

export function getClient(market: Market): StorefrontApiClient | null {
  const cfg = MARKETS[market];
  if (!cfg.shopifyDomain || !cfg.shopifyToken) return null;

  const key = `${cfg.shopifyDomain}::${cfg.shopifyToken}`;
  const cached = clientCache.get(key);
  if (cached) return cached;

  const client = createStorefrontApiClient({
    storeDomain: cfg.shopifyDomain,
    apiVersion: API_VERSION,
    publicAccessToken: cfg.shopifyToken,
  });
  clientCache.set(key, client);
  return client;
}

export async function runQuery<T>(
  market: Market,
  query: string,
  variables: Record<string, unknown> = {},
): Promise<T | null> {
  const client = getClient(market);
  if (!client) {
    console.warn(`[shopify] No credentials for market="${market}" — returning null.`);
    return null;
  }

  try {
    const { data, errors } = await client.request<T>(query, { variables });
    if (errors) {
      console.error(`[shopify] GraphQL errors for market="${market}":`, errors);
      return null;
    }
    return data ?? null;
  } catch (err) {
    console.error(`[shopify] Request failed for market="${market}":`, err);
    return null;
  }
}
