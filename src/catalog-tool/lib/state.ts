// What the editor and the preview need about one product, read fresh from disk.
import sharp from 'sharp';
import { colourPhotos, altFor } from './photos.mjs';
import { slug } from './paths.mjs';
import { readProduct, readNotes, photoUrl, type ProductFile } from './catalog';
import type { ProductDetail, ShopifyImage } from '~/types/shopify';

export type PhotoInfo = { file: string; label: string; thumb: string; full: string; width: number; height: number; warn: string[] };

const sizes = new Map<string, { width: number; height: number }>();
async function sizeOf(file: string, mtime: number) {
  const k = `${file}:${mtime}`;
  if (!sizes.has(k)) {
    try {
      const m = await sharp(file).metadata();
      const turned = (m.orientation ?? 1) >= 5;
      sizes.set(k, { width: (turned ? m.height : m.width) ?? 0, height: (turned ? m.width : m.height) ?? 0 });
    } catch { sizes.set(k, { width: 0, height: 0 }); }
  }
  return sizes.get(k)!;
}

export async function colourPhotoInfo(key: string, folder: string): Promise<PhotoInfo[]> {
  return Promise.all(colourPhotos(key, folder).map(async (p: { file: string; label: string; path: string; mtime: number }) => {
    const { width, height } = await sizeOf(p.path, p.mtime);
    const warn: string[] = [];
    if (!width) warn.push('Could not read this image');
    else {
      // The page shows gallery photos up to 1100 px wide, so 1080 × 1350 is the smallest that stays sharp.
      if (Math.max(width, height) < 1300) warn.push(`Small (${width}×${height}): may look soft`);
      if (Math.abs(width / height - 0.8) > 0.03) warn.push(`Not 4:5 (${width}×${height}): the page crops it`);
    }
    const rel = `${folder}/${p.file}`;
    return { file: p.file, label: p.label, thumb: photoUrl(key, rel, 360) + `&v=${Math.round(p.mtime)}`, full: photoUrl(key, rel) + `?v=${Math.round(p.mtime)}`, width, height, warn };
  }));
}

export async function editorState(id: string) {
  const P = readProduct(id);
  const photos: Record<string, PhotoInfo[]> = {};
  for (const c of P.colours) if (c.folder) photos[c.folder] = await colourPhotoInfo(P.key, c.folder);
  return { id, P, notes: readNotes(P.name || P.title), photos };
}

const local = (P: ProductFile, v?: string) => (!v ? '' : /^https:\/\//.test(v) ? v : photoUrl(P.key, v, 2000));

/** The draft, shaped exactly like the product the live page gets from Shopify. */
export async function previewProduct(P: ProductFile, store: 'india' | 'global'): Promise<ProductDetail> {
  const currencyCode = store === 'india' ? 'INR' : 'USD';
  const amount = String(Number(P.price[store]) || 0);
  const money = { amount, currencyCode };
  const images: ShopifyImage[] = [];
  const firstOf: Record<string, ShopifyImage> = {};
  for (const c of P.colours) {
    for (const p of await colourPhotoInfo(P.key, c.folder)) {
      const img = { url: photoUrl(P.key, `${c.folder}/${p.file}`, 1600), altText: altFor(P, c.name, p.label), width: p.width || null, height: p.height || null };
      images.push(img);
      firstOf[c.name] ??= img;
    }
  }
  const slides = (() => { try { return JSON.parse(P.custom.story_slides || '[]'); } catch { return []; } })()
    .map((s: { image?: string }) => ({ ...s, image: local(P, s.image) }));
  const mf = (v?: string) => (v && String(v).trim() ? { value: String(v) } : null);
  const description = P.descriptionHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  return {
    id: `gid://shopify/Product/preview-${P.key}`,
    handle: P.handle,
    title: P.title,
    description,
    descriptionHtml: P.descriptionHtml,
    availableForSale: true,
    vendor: 'Mir Kash',
    productType: P.productType,
    tags: P.tags,
    featuredImage: images[0] ?? null,
    images: { edges: images.map((node) => ({ node })) },
    variants: {
      edges: P.colours.map((c, i) => ({
        node: {
          id: `gid://shopify/ProductVariant/preview-${i}`, title: c.name, availableForSale: true, sku: c.sku,
          price: money, compareAtPrice: null, selectedOptions: [{ name: 'Color', value: c.name }], image: firstOf[c.name] ?? null,
        },
      })),
    },
    priceRange: { minVariantPrice: money, maxVariantPrice: money },
    compareAtPriceRange: { minVariantPrice: { amount: '0', currencyCode }, maxVariantPrice: { amount: '0', currencyCode } },
    options: [{ name: 'Color', values: P.colours.map((c) => c.name) }],
    seo: { title: P.seoTitle, description: P.seoDescription[store] },
    storySlides: mf(JSON.stringify(slides)),
    featureCards: mf(P.custom.feature_cards),
    fullbleedImage: mf(local(P, P.banner?.desktop)),
    fullbleedImageMobile: mf(local(P, P.banner?.mobile)),
    productDetails: mf(P.custom.product_details),
    careGuide: mf(P.custom.care_guide),
    shippingReturn: mf(P.shippingReturn[store]),
    dimensions: mf(P.custom.dimensions),
    materialName: mf(P.custom.material_name),
    materialStory: mf(P.custom.material_story),
    warranty: null,
    faq: mf(P.custom.faq),
    sizeGroup: mf(P.custom.size_group),
    sizeOrder: mf(P.custom.size_order),
    reels: null,
    carryOptions: { references: { nodes: (P.categoryAttrs['carry-options'] ?? []).map((n) => ({ handle: slug(n) })) } },
  };
}
