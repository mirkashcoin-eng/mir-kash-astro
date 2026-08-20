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
  availableForSale: boolean;
  vendor: string;
  productType: string;
  tags: string[];
  featuredImage: ShopifyImage | null;
  images: { edges: Array<{ node: ShopifyImage }> };
  variants: { edges: Array<{ node: ProductVariant }> };
  priceRange: MoneyRange;
  compareAtPriceRange: MoneyRange;
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

export interface ProductOption {
  name: string;
  values: string[];
}

// Richer product returned by getProductByHandle (PDP).
export interface ProductDetail extends Product {
  descriptionHtml: string;
  options: ProductOption[];
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
    product: { title: string; handle: string };
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
