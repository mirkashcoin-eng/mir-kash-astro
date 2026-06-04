import { runQuery } from './client';
import {
  IMAGE_FRAGMENT,
  MONEY_FRAGMENT,
  PRODUCT_FRAGMENT,
  PRODUCT_PAGE_FRAGMENT,
  COLLECTION_FRAGMENT,
} from './fragments';
import type { Market } from '~/types/market';
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
  query ProductsByCollection($handle: String!, $first: Int!) {
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
  query AllProducts($first: Int!, $after: String) {
    products(first: $first, after: $after) {
      edges {
        node { ...ProductFields }
        cursor
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

export async function getProductsByCollection(
  market: Market,
  handle: string,
  first = 4,
): Promise<Product[]> {
  const data = await runQuery<CollectionByHandleResponse>(market, GET_PRODUCTS_BY_COLLECTION, {
    handle,
    first,
  });
  if (!data?.collection) return [];
  return data.collection.products.edges.map((e) => e.node);
}

export async function getAllProducts(market: Market, first = 48): Promise<Product[]> {
  const data = await runQuery<ProductsResponse>(market, GET_ALL_PRODUCTS, { first });
  if (!data?.products) return [];
  return data.products.edges.map((e) => e.node);
}

const GET_PRODUCT_BY_HANDLE = /* GraphQL */ `
  ${IMAGE_FRAGMENT}
  ${MONEY_FRAGMENT}
  ${PRODUCT_PAGE_FRAGMENT}
  query ProductByHandle($handle: String!) {
    product(handle: $handle) {
      ...ProductPageFields
    }
  }
`;

export async function getProductByHandle(
  market: Market,
  handle: string,
): Promise<ProductDetail | null> {
  const data = await runQuery<ProductByHandleResponse>(market, GET_PRODUCT_BY_HANDLE, { handle });
  return data?.product ?? null;
}
