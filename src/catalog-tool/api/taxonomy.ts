// The Shopify category attributes the tool offers for a category (values come from Shopify's own taxonomy).
import type { APIRoute } from 'astro';
import { admin } from '../lib/admin.mjs';
import { slug } from '../lib/paths.mjs';
import { json, fail } from '../lib/http';

// Colour and pattern need special swatch entries; care instructions are about washing. The rest are offered.
const SKIP = new Set(['color-pattern', 'pattern', 'care-instructions']);
const cache = new Map<string, unknown>();

export const GET: APIRoute = async ({ url }) => {
  const id = url.searchParams.get('category') ?? '';
  if (!/^gid:\/\/shopify\/TaxonomyCategory\/[a-z0-9-]+$/.test(id)) return fail('Unknown category');
  try {
    if (!cache.has(id)) {
      const node = (await admin('global', `query($id:ID!){ node(id:$id){ ... on TaxonomyCategory { attributes(first: 60) { nodes { ... on TaxonomyChoiceListAttribute { name values(first: 250) { nodes { name } } } } } } } }`, { id })).node;
      const attrs = (node?.attributes?.nodes ?? [])
        .filter((a: { name?: string }) => a.name)
        .map((a: { name: string; values: { nodes: Array<{ name: string }> } }) => ({ key: slug(a.name) === 'color' ? 'color-pattern' : slug(a.name), name: a.name, values: a.values.nodes.map((v) => v.name) }))
        .filter((a: { key: string }) => !SKIP.has(a.key));
      cache.set(id, attrs);
    }
    return json(cache.get(id));
  } catch (e) {
    return fail(e, 502);
  }
};
