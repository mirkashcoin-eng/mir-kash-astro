// Shop category pages (/shop/crossbody-bags, /shop/tote-bags, …).
//
// Each category resolves its products two ways, in this order:
//   1. the Shopify collection of the same handle — the merchandiser's explicit,
//      hand-ordered list, so it wins;
//   2. anything whose productType matches, for products the collection misses
//      (and for Totes, which has no collection on either store).
// The union is de-duped in CategoryPage; everything left over renders below it
// in the same infinite-scroll grid the live Shop All page uses.
//
// productType is matched, NOT tags: several bags carry a "Shoulder bag" tag on
// top of a "Crossbody Bag" type, and matching tags puts one product in three
// categories at once.

export interface Category {
  slug: string;
  /** Plural display name — breadcrumb, tile label, <title>. */
  title: string;
  /** Tile label; shorter than `title` where the full name doesn't fit. */
  short: string;
  /** Masthead H1, split over two lines (mirrors shop-title__h1's two-line set). */
  h1: [string, string];
  /** Shopify collection handle, or null where no collection exists. */
  collection: string | null;
  /** Fallback match against productType. */
  match: RegExp;
  sub: string;
  seoTitle: string;
  seoDescription: string;
}

export const CATEGORIES: Category[] = [
  {
    slug: 'crossbody-bags',
    title: 'Crossbody Bags',
    short: 'Crossbody',
    h1: ['Crossbody', 'Bags'],
    collection: 'crossbody-bags',
    match: /cross\s*body/i,
    sub: 'The bag you forget you are wearing. Worn long across the body and sized for a phone, a cardholder and keys — cut from premium vegan leather and finished by hand.',
    seoTitle: 'Crossbody Bags — Vegan Leather Crossbody Bags | Mir Kash',
    seoDescription:
      'Shop Mir Kash crossbody bags in premium vegan leather. Adjustable and detachable straps, hands-free all day, cruelty-free and 100% animal leather-free.',
  },
  {
    slug: 'shoulder-bags',
    title: 'Shoulder Bags',
    short: 'Shoulder',
    h1: ['Shoulder', 'Bags'],
    collection: 'shoulder-bags',
    match: /shoulder/i,
    sub: 'Structured shapes that sit on the shoulder and stay there. The hand-braided Braidey, the sculptural Trapees — both cut from premium vegan leather.',
    seoTitle: 'Shoulder Bags — Vegan Leather Shoulder Bags | Mir Kash',
    seoDescription:
      'Shop Mir Kash shoulder bags in premium vegan leather. The hand-braided Braidey and structured Trapees — detachable straps, cruelty-free, animal leather-free.',
  },
  {
    slug: 'clutches',
    title: 'Clutches',
    short: 'Clutches',
    h1: ['Evening', 'Clutches'],
    collection: 'clutches',
    match: /clutch/i,
    sub: 'Evening bags built to catch light — apple leather, rhinestone and crystal, sized for a phone, a card and a lip balm.',
    seoTitle: 'Clutches — Vegan Leather Evening Clutch Bags | Mir Kash',
    seoDescription:
      'Shop Mir Kash clutches for evenings and weddings. Apple leather and crystal-embellished evening bags, cruelty-free and 100% animal leather-free.',
  },
  {
    slug: 'mini-bags',
    title: 'Mini Bags',
    short: 'Mini Bags',
    h1: ['Mini', 'Bags'],
    collection: 'mini-bags',
    match: /mini/i,
    sub: 'Petite by design. Room for a phone, a card and a key — and a structured base that holds its shape whether the bag is full or empty.',
    seoTitle: 'Mini Bags — Small Vegan Leather Bags | Mir Kash',
    seoDescription:
      'Shop Mir Kash mini bags in soft vegan leather. Petite silhouettes for evenings and everyday, cruelty-free and 100% animal leather-free.',
  },
  {
    slug: 'tote-bags',
    title: 'Tote Bags',
    short: 'Totes',
    h1: ['Tote', 'Bags'],
    // No `tote-bags` collection exists on either store — the productType match
    // below is what actually populates this page.
    collection: 'tote-bags',
    match: /tote/i,
    sub: 'Lattice-worked vegan leather over a structured base. Roomy enough for a 13-inch laptop, light enough to carry through the whole day.',
    seoTitle: 'Tote Bags — Vegan Leather Work Totes | Mir Kash',
    seoDescription:
      'Shop Mir Kash tote bags in lattice-worked vegan leather. Fits a 13-inch laptop, structured base, cruelty-free and 100% animal leather-free.',
  },
];

export function getCategory(slug: string): Category | undefined {
  return CATEGORIES.find((c) => c.slug === slug);
}

export function listCategories(): Category[] {
  return CATEGORIES;
}

/** Every category URL, for the sitemap. */
export const CATEGORY_PATHS = CATEGORIES.map((c) => `/shop/${c.slug}`);
