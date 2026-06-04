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
  lineTotal: number;
  image: string | null;
}

export interface CartView {
  id: string;
  checkoutUrl: string;
  totalQuantity: number;
  subtotal: number;
  total: number;
  currency: string;
  lines: CartLineView[];
}
