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
    sub: 'The bag you forget you are wearing. Worn long across the body, with room for your phone, cards and keys, from the Carla with its fold-out pocket to the Bucky and its scarf.',
    seoTitle: 'Vegan Leather Crossbody Bags | Mir Kash',
    seoDescription:
      'Shop Mir Kash vegan leather crossbody bags: light, easy to wear, and made slowly to be carried for years, not seasons.',
  },
  {
    slug: 'shoulder-bags',
    title: 'Shoulder Bags',
    short: 'Shoulder',
    h1: ['Shoulder', 'Bags'],
    collection: 'shoulder-bags',
    match: /shoulder/i,
    sub: 'Shapes that sit on the shoulder and stay there. The braided Braidey in apple leather, the trapeze-shaped Trapees, the Tory with its heart charm.',
    seoTitle: 'Vegan Leather Shoulder Bags | Mir Kash',
    seoDescription:
      'Shop Mir Kash vegan leather shoulder bags, from the braided Braidey to the sculpted Trapees. Made slowly, worn for years.',
  },
  {
    slug: 'clutches',
    title: 'Clutches',
    short: 'Clutches',
    h1: ['Evening', 'Clutches'],
    collection: 'clutches',
    match: /clutch/i,
    sub: 'Evening bags built to catch light: rhinestones on apple leather and satin, sized for a phone, a card and a lipstick. Spare stones in every box.',
    seoTitle: 'Rhinestone Evening Clutches | Mir Kash',
    seoDescription:
      'Shop Mir Kash clutches set with rhinestones, for parties, weddings and nights out. Spare stones come in every box.',
  },
  {
    slug: 'mini-bags',
    title: 'Mini Bags',
    short: 'Mini Bags',
    h1: ['Mini', 'Bags'],
    collection: 'mini-bags',
    match: /mini/i,
    sub: 'Small by design, with room for a phone, a card and a key. In vegan leather, velvet and rhinestones.',
    seoTitle: 'Vegan Leather Mini Bags | Mir Kash',
    seoDescription:
      'Shop Mir Kash mini bags in vegan leather, velvet and rhinestones: small in size, with room for your phone and essentials.',
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
    sub: 'The Weaver, in textured apple leather. Room for a 13-inch laptop, long handles, and light enough to carry through the whole day.',
    seoTitle: 'Vegan Leather Tote Bags | Mir Kash',
    seoDescription:
      'Shop the Mir Kash apple leather tote: long handles, zipped pockets and room for a 13-inch laptop and your whole day.',
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
