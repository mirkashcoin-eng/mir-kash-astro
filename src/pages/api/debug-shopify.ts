import type { APIRoute } from 'astro';
import { STORE_CREDS } from '~/lib/markets';

export const prerender = false;

// TEMPORARY diagnostic — reports why a store's products fail to load on Vercel.
// Exposes NO secrets (token length only). Remove after debugging.
export const GET: APIRoute = async () => {
  const out: Record<string, unknown> = {};

  for (const store of ['india', 'global'] as const) {
    const cfg = STORE_CREDS[store];
    const entry: Record<string, unknown> = {
      domain: cfg.shopifyDomain || null,
      token_present: !!cfg.shopifyToken,
      token_len: (cfg.shopifyToken || '').length,
    };

    if (cfg.shopifyDomain && cfg.shopifyToken) {
      const country = store === 'india' ? 'IN' : 'US';
      const url = `https://${cfg.shopifyDomain}/api/2025-01/graphql.json`;
      const body = JSON.stringify({
        query: `query @inContext(country: ${country}, language: EN){ c: collection(handle: "first-scroller"){ products(first: 4){ edges{ node{ title } } } } }`,
      });
      try {
        const r = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Shopify-Storefront-Access-Token': cfg.shopifyToken,
          },
          body,
        });
        entry.http_status = r.status;
        const text = await r.text();
        let j: any = null;
        try {
          j = JSON.parse(text);
        } catch {
          entry.non_json_snippet = text.slice(0, 200);
        }
        if (j?.errors) entry.gql_errors = JSON.stringify(j.errors).slice(0, 300);
        const c = j?.data?.c;
        entry.result = c ? `${c.products.edges.length} products` : c === null ? 'collection-null' : 'no-data';
      } catch (e: any) {
        entry.fetch_error = String(e?.message || e).slice(0, 300);
      }
    }

    out[store] = entry;
  }

  return new Response(JSON.stringify(out, null, 2), {
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
};
