// The Google Shopping fields (mm-google-shopping metafields), worked out from the product's category, type and tags.
export function googleFields(P) {
  const accessory = /TaxonomyCategory\/aa-4/.test(P.category ?? '');
  const passHolder = /TaxonomyCategory\/aa-5-1\b/.test(P.category ?? '');
  const occasion = (P.tags ?? []).find((t) => t.startsWith('occasion-'))?.replace('occasion-', '') || 'everyday';
  return {
    google_product_category: passHolder ? 'Apparel & Accessories > Handbags, Wallets & Cases > Badge & Pass Holders'
      : accessory ? 'Apparel & Accessories > Handbag & Wallet Accessories' : 'Apparel & Accessories > Handbags, Wallets & Cases > Handbags',
    gender: 'female', age_group: 'adult', condition: 'new',
    custom_label_0: P.productType ?? '', custom_label_1: occasion, custom_product: 'true',
  };
}
