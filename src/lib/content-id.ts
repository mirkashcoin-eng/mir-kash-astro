/**
 * The Meta catalog id for a Shopify variant: its numeric id ("gid://shopify/ProductVariant/67593334915287" →
 * "67593334915287"). The catalog (synced by Shopify's Facebook & Instagram channel) keys items by this number, so
 * every pixel and Conversions API event must send it as content_ids, or catalog ads and product retargeting can't
 * match views and sales to products. No Node imports: browser scripts use it too.
 */
export const contentId = (variantGid: string): string => String(variantGid).split('/').pop() || String(variantGid);
