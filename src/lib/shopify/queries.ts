import { runQuery } from './client';
import {
  IMAGE_FRAGMENT,
  MONEY_FRAGMENT,
  PRODUCT_FRAGMENT,
  PRODUCT_PAGE_FRAGMENT,
  COLLECTION_FRAGMENT,
} from './fragments';
import type { Store } from '~/types/market';
import type {
  Product,
  ProductDetail,
  ProductByHandleResponse,
  CollectionByHandleResponse,
  ProductsResponse,
} from '~/types/shopify';

const GET_PRODUCTS_BY_COLLECTION = /* GraphQL */ `
  ${IMAGE_FRAGMENT}
  ${MONEY_FRAGMENT}
  ${PRODUCT_FRAGMENT}
  ${COLLECTION_FRAGMENT}
  query ProductsByCollection($handle: String!, $first: Int!, $country: CountryCode!, $language: LanguageCode!)
  @inContext(country: $country, language: $language) {
    collection(handle: $handle) {
      ...CollectionFields
      products(first: $first) {
        edges {
          node { ...ProductFields }
          cursor
        }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
`;

const GET_ALL_PRODUCTS = /* GraphQL */ `
  ${IMAGE_FRAGMENT}
  ${MONEY_FRAGMENT}
  ${PRODUCT_FRAGMENT}
  query AllProducts($first: Int!, $after: String, $country: CountryCode!, $language: LanguageCode!)
  @inContext(country: $country, language: $language) {
    products(first: $first, after: $after) {
      edges {
        node { ...ProductFields }
        cursor
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

const GET_PRODUCT_BY_HANDLE = /* GraphQL */ `
  ${IMAGE_FRAGMENT}
  ${MONEY_FRAGMENT}
  ${PRODUCT_PAGE_FRAGMENT}
  query ProductByHandle($handle: String!, $country: CountryCode!, $language: LanguageCode!)
  @inContext(country: $country, language: $language) {
    product(handle: $handle) {
      ...ProductPageFields
    }
  }
`;

export async function getProductsByCollection(
  store: Store,
  country: string,
  handle: string,
  first = 4,
): Promise<Product[]> {
  const data = await runQuery<CollectionByHandleResponse>(
    store,
    GET_PRODUCTS_BY_COLLECTION,
    { handle, first },
    country,
  );
  if (!data?.collection) return [];
  return data.collection.products.edges.map((e) => e.node);
}

export async function getAllProducts(store: Store, country: string, first = 48): Promise<Product[]> {
  const data = await runQuery<ProductsResponse>(store, GET_ALL_PRODUCTS, { first }, country);
  if (!data?.products) return [];
  return data.products.edges.map((e) => e.node);
}

export async function getProductByHandle(
  store: Store,
  country: string,
  handle: string,
): Promise<ProductDetail | null> {
  const data = await runQuery<ProductByHandleResponse>(
    store,
    GET_PRODUCT_BY_HANDLE,
    { handle },
    country,
  );
  return data?.product ?? null;
}
