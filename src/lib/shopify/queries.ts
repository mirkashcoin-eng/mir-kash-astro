import { runQuery } from './client';
import { IMAGE_FRAGMENT, MONEY_FRAGMENT, PRODUCT_FRAGMENT, COLLECTION_FRAGMENT } from './fragments';
import type { Market } from '~/types/market';
import type {
  Product,
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
