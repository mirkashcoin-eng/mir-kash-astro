export interface Money {
  amount: string;
  currencyCode: string;
}

export interface MoneyRange {
  minVariantPrice: Money;
  maxVariantPrice: Money;
}

export interface ShopifyImage {
  url: string;
  altText: string | null;
  width: number | null;
  height: number | null;
}

export interface ProductVariant {
  id: string;
  title: string;
  availableForSale: boolean;
  sku?: string | null;
  price: Money;
  compareAtPrice: Money | null;
  selectedOptions: Array<{ name: string; value: string }>;
  image: ShopifyImage | null;
}

export interface Product {
  id: string;
  handle: string;
  title: string;
  description: string;
  descriptionHtml: string;
  availableForSale: boolean;
  vendor: string;
  productType: string;
  tags: string[];
  featuredImage: ShopifyImage | null;
  images: { edges: Array<{ node: ShopifyImage }> };
  variants: { edges: Array<{ node: ProductVariant }> };
  priceRange: MoneyRange;
  compareAtPriceRange: MoneyRange;
  // custom.size_order (1 = smallest). Only the consolidated one-product-per-bag listings have it.
  sizeOrder?: { value: string } | null;
}

export interface Collection {
  id: string;
  handle: string;
  title: string;
  description: string;
  image: ShopifyImage | null;
}

export interface ProductsConnection {
  edges: Array<{ node: Product; cursor: string }>;
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
}

export interface CollectionByHandleResponse {
  collection: (Collection & { products: ProductsConnection }) | null;
}

export interface ProductsResponse {
  products: ProductsConnection;
}

export interface ProductRecommendationsResponse {
  productRecommendations: Product[] | null;
}

export interface ProductOption {
  name: string;
  values: string[];
}

type Metafield = { value: string } | null;

// Richer product returned by getProductByHandle (PDP).
export interface ProductDetail extends Product {
  descriptionHtml: string;
  options: ProductOption[];
  seo?: { title: string | null; description: string | null } | null;
  // custom.* metafields. All optional: null until set in Shopify, and the page falls back or hides the section.
  // The "JSON" ones are stored as multi-line text (CSV-importable) and parsed in ProductPage.astro.
  storySlides?: Metafield;      // [{ eyebrow?, title, body }, …]
  featureCards?: Metafield;     // [{ eyebrow, title, body }, …]  (3 cards)
  // custom.reels: this product's own videos, uploaded in Shopify admin (list.file_reference → Video).
  reels?: { references?: { nodes: Array<{ sources?: Array<{ url: string; mimeType: string; height?: number | null }>; previewImage?: { url: string } | null }> } | null } | null;
  fullbleedImage?: Metafield;   // https URL of the full-width editorial image (21:9 desktop)
  fullbleedImageMobile?: Metafield;   // https URL of its 4:5 phone version
  productDetails?: Metafield;   // one bullet per line
  careGuide?: Metafield;
  shippingReturn?: Metafield;   // one line per point, market-specific
  dimensions?: Metafield;
  materialName?: Metafield;
  materialStory?: Metafield;
  warranty?: Metafield;
  tagline?: Metafield;          // one-line hook under the name
  faq?: Metafield;              // [{ q, a }, …]
  sizeGroup?: Metafield;        // Mini / Small / Medium / Large
  // shopify.carry-options (standard category metafield): list of metaobject references, e.g. handle "crossbody-strap".
  carryOptions?: { references?: { nodes: Array<{ handle?: string }> } | null } | null;
}

export interface ProductByHandleResponse {
  product: ProductDetail | null;
}

// ─── Cart ───────────────────────────────────────────────────────────────────

export interface ShopifyCartLine {
  id: string;
  quantity: number;
  cost: { totalAmount: Money };
  merchandise: {
    id: string;
    title: string;
    price: Money;
    image: ShopifyImage | null;
    product: { title: string; handle: string; materialName?: { value: string } | null };
  };
}

export interface ShopifyCart {
  id: string;
  checkoutUrl: string;
  totalQuantity: number;
  discountCodes?: Array<{ applicable: boolean; code: string }>;
  cost: { subtotalAmount: Money; totalAmount: Money };
  lines: { edges: Array<{ node: ShopifyCartLine }> };
}

// Normalized cart used across the app (page, endpoints, header).
export interface CartLineView {
  id: string;
  merchandiseId: string;
  quantity: number;
  title: string;
  variantTitle: string;
  material: string;               // custom.material_name, e.g. "Italian apple leather" (shown with the leaf)
  handle: string;
  price: number;
  lineTotal: number;              // GROSS: price × quantity, before any discount
  image: string | null;
}

export interface CartView {
  id: string;
  checkoutUrl: string;
  totalQuantity: number;
  subtotal: number;              // Σ lineTotal — gross, NOT cost.subtotalAmount (see normalize)
  total: number;
  currency: string;
  discountCode: string | null;   // an applied, applicable code
  // Total off (subtotal − total): covers cart-level, line-allocated AND automatic
  // discounts. This is what the draft order's FIXED_AMOUNT discount is set to.
  discountAmount: number;
  lines: CartLineView[];
}
