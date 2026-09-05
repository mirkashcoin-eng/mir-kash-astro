// Shop category pages (/shop/crossbody-bags, /shop/tote-bags, …).
//
// Each category resolves its products two ways, in this order:
//   1. the Shopify collection of the same handle — the merchandiser's explicit,
//      hand-ordered list, so it wins;
//   2. anything whose productType matches, for products the collection misses
//      (and for Totes, which has no collection on either store).
// The union is de-duped in CategoryPage; everything left over becomes the
// "More from Mir Kash" grid further down the page.
//
// productType is matched, NOT tags: several bags carry a "Shoulder bag" tag on
// top of a "Crossbody Bag" type, and matching tags puts one product in three
// categories at once.

export interface CategoryNote {
  label: string;
  text: string;
}

export interface CategoryFaq {
  q: string;
  a: string;
}

export interface Category {
  slug: string;
  /** Plural display name — breadcrumb, rail, <title>. */
  title: string;
  /** Rail label; shorter than `title` where the full name doesn't fit. */
  short: string;
  /** Masthead H1, split over two lines. */
  h1: [string, string];
  /** Shopify collection handle, or null where no collection exists. */
  collection: string | null;
  /** Fallback match against productType. */
  match: RegExp;
  sub: string;
  seoTitle: string;
  seoDescription: string;
  eyebrow: string;
  headline: [string, string];
  notes: CategoryNote[];
  faqs: CategoryFaq[];
  /**
   * Where a visitor goes when this category is nearly empty. Rendered as a
   * bridge card that absorbs the last row's empty slots, so a two-product
   * category never leaves a half-finished row.
   */
  bridge: { slug: string; heading: string; text: string };
}

// Answers shared by every category — all drawn from the storefront's own
// promises (footer + ticker), so nothing here overstates the actual policy.
const COMMON_FAQS: CategoryFaq[] = [
  {
    q: 'Is Mir Kash vegan leather really leather-free?',
    a: 'Yes. Every bag is 100% animal leather-free and cruelty-free — premium vegan leather, with apple leather from Italy on selected styles.',
  },
  {
    q: 'What if it is not right for me?',
    a: 'Order it, try it, and take 14 days to decide. Returns are no-question. Every bag also carries a 1-year warranty.',
  },
  {
    q: 'Do you ship outside India?',
    a: 'Yes — Mir Kash ships worldwide, and prices are shown in your local currency.',
  },
];

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
    eyebrow: 'The crossbody edit',
    headline: ['Hands free,', 'all day long.'],
    notes: [
      {
        label: 'The strap',
        text: 'Adjustable on the Charlotte, detachable on the Carla, crossbody webbing with a top handle on the Coco. Every one of them wears long across the body.',
      },
      {
        label: 'What fits',
        text: 'Phone, cardholder, keys. The Bucky opens into one roomy compartment, the Tory splits into three, and the Carla is sized for an evening and nothing more.',
      },
      {
        label: 'The material',
        text: 'Premium vegan leather — pebbled, smooth, or soft velvet on the Skrunchy. Cruelty-free, 100% animal leather-free.',
      },
    ],
    faqs: [
      {
        q: 'What is a crossbody bag best for?',
        a: 'Days when you want both hands. The strap sits across the body so the bag stays where you put it while you walk, commute or carry something else — and the smaller shapes still read as evening bags.',
      },
      ...COMMON_FAQS,
    ],
    bridge: {
      slug: 'shoulder-bags',
      heading: 'Want it on the shoulder?',
      text: 'Every chain and strap on the Braidey detaches, so it wears crossbody too — with more room inside.',
    },
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
    eyebrow: 'The shoulder edit',
    headline: ['Sculptural.', 'Still practical.'],
    notes: [
      {
        label: 'The silhouette',
        text: 'The Trapees is a structured trapezoid box with long extended handles. The Braidey is soft over a structured body, hand-braided across the exterior.',
      },
      {
        label: 'Three ways to wear',
        text: 'Every chain and strap on the Braidey detaches — over the shoulder, crossbody, or by hand.',
      },
      {
        label: 'What fits',
        text: 'Wallet, phone, keys and the rest of a full day out, behind gold-toned chain and clasps that add no real weight.',
      },
    ],
    faqs: [
      {
        q: 'Can a shoulder bag be worn crossbody?',
        a: 'On the Braidey, yes — the chain and the adjustable leather strap both detach, so it wears three ways. The Trapees is built around its long top handles and stays on the shoulder.',
      },
      ...COMMON_FAQS,
    ],
    bridge: {
      slug: 'crossbody-bags',
      heading: 'Rather go hands free?',
      text: 'The crossbody shapes carry the same day, worn long across the body instead of on the shoulder.',
    },
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
    eyebrow: 'The evening edit',
    headline: ['Small bag,', 'long night.'],
    notes: [
      {
        label: 'The material',
        text: 'The Foxy is apple leather — plant-based, cruelty-free — encrusted with rhinestones. The Kelly is vegan leather lined in soft faux suede.',
      },
      {
        label: 'Wear it three ways',
        text: 'The Kelly carries straps for shoulder, crossbody or handheld. The Foxy stays a clutch, and stays small.',
      },
      {
        label: 'The occasion',
        text: 'Parties, weddings, evenings out — anywhere bulk is the enemy and being seen is the point.',
      },
    ],
    faqs: [
      {
        q: 'What fits inside an evening clutch?',
        a: 'Phone, wallet, lip balm and the rest of a night out. The Kelly is structured so it holds all of that without going shapeless.',
      },
      ...COMMON_FAQS,
    ],
    bridge: {
      slug: 'mini-bags',
      heading: 'Need a strap on it?',
      text: 'The mini bags carry the same essentials, with a handle or a strap you can actually walk in.',
    },
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
    eyebrow: 'The mini edit',
    headline: ['Less bag,', 'more evening.'],
    notes: [
      {
        label: 'The shape',
        text: 'The GIGI is built around a twisted knot handle, kept exactly as it fell the first time we twisted it. The Carla takes after a vintage vanity case.',
      },
      {
        label: 'What fits',
        text: 'Phone, cardholder, lip balm. Structured bases mean they hold their shape whether they are full or empty.',
      },
      {
        label: 'The material',
        text: 'Soft vegan leather inside and out, apple leather on the Foxy. Cruelty-free, 100% animal leather-free.',
      },
    ],
    faqs: [
      {
        q: 'Are mini bags big enough for everyday?',
        a: 'For a phone, a cardholder and keys, yes — that is what they are cut for. If you carry more than that through the day, the crossbody and shoulder shapes are the ones to look at.',
      },
      ...COMMON_FAQS,
    ],
    bridge: {
      slug: 'clutches',
      heading: 'Dressing it up?',
      text: 'The clutches go further for an evening — apple leather, rhinestone and crystal, built to catch light.',
    },
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
    eyebrow: 'The tote edit',
    headline: ['Work bag.', 'Still yours.'],
    notes: [
      {
        label: 'The texture',
        text: 'The Weaver takes the Braidey’s braided play further, with intricate lattice detailing worked across the exterior.',
      },
      {
        label: 'What fits',
        text: 'A 13-inch MacBook, an iPad, wallet, keys, water bottle — and whatever else the day adds to the pile.',
      },
      {
        label: 'The build',
        text: 'Soft but structured, with a base that keeps it upright and a zip closure. Light enough that you do not feel it on the long days.',
      },
    ],
    faqs: [
      {
        q: 'Will a laptop fit?',
        a: 'The Weaver Tote takes a 13-inch MacBook alongside an iPad, a wallet, keys and a water bottle, and a structured base keeps it upright while it does.',
      },
      ...COMMON_FAQS,
    ],
    bridge: {
      slug: 'shoulder-bags',
      heading: 'Not quite a tote?',
      text: 'The Weaver grew out of the Braidey — the same braided texture play, in a smaller frame that carries almost as much.',
    },
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
