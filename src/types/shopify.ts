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
