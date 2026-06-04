import { runQuery } from './client';
import { IMAGE_FRAGMENT, MONEY_FRAGMENT, CART_FRAGMENT } from './fragments';
import type { Market } from '~/types/market';
import type { ShopifyCart, CartView } from '~/types/shopify';

const FRAGMENTS = `${IMAGE_FRAGMENT}${MONEY_FRAGMENT}${CART_FRAGMENT}`;

const CART_QUERY = /* GraphQL */ `
  ${FRAGMENTS}
  query Cart($id: ID!) {
    cart(id: $id) { ...CartFields }
  }
`;

const CART_CREATE = /* GraphQL */ `
  ${FRAGMENTS}
  mutation CartCreate($lines: [CartLineInput!]) {
    cartCreate(input: { lines: $lines }) {
      cart { ...CartFields }
      userErrors { field message }
    }
  }
`;

const CART_LINES_ADD = /* GraphQL */ `
  ${FRAGMENTS}
  mutation CartLinesAdd($cartId: ID!, $lines: [CartLineInput!]!) {
    cartLinesAdd(cartId: $cartId, lines: $lines) {
      cart { ...CartFields }
      userErrors { field message }
    }
  }
`;

const CART_LINES_UPDATE = /* GraphQL */ `
  ${FRAGMENTS}
  mutation CartLinesUpdate($cartId: ID!, $lines: [CartLineUpdateInput!]!) {
    cartLinesUpdate(cartId: $cartId, lines: $lines) {
      cart { ...CartFields }
      userErrors { field message }
    }
  }
`;

const CART_LINES_REMOVE = /* GraphQL */ `
  ${FRAGMENTS}
  mutation CartLinesRemove($cartId: ID!, $lineIds: [ID!]!) {
    cartLinesRemove(cartId: $cartId, lineIds: $lineIds) {
      cart { ...CartFields }
      userErrors { field message }
    }
  }
`;

function normalize(cart: ShopifyCart | null | undefined): CartView | null {
  if (!cart) return null;
  return {
    id: cart.id,
    checkoutUrl: cart.checkoutUrl,
    totalQuantity: cart.totalQuantity,
    subtotal: Number(cart.cost.subtotalAmount.amount),
    total: Number(cart.cost.totalAmount.amount),
    currency: cart.cost.totalAmount.currencyCode,
    lines: cart.lines.edges.map(({ node }) => ({
      id: node.id,
      merchandiseId: node.merchandise.id,
      quantity: node.quantity,
      title: node.merchandise.product.title,
      variantTitle: node.merchandise.title,
      handle: node.merchandise.product.handle,
      price: Number(node.merchandise.price.amount),
      lineTotal: Number(node.cost.totalAmount.amount),
      image: node.merchandise.image?.url ?? null,
    })),
  };
}

interface CartMutationResult {
  cart: ShopifyCart | null;
  userErrors: Array<{ field: string[] | null; message: string }>;
}

export async function getCart(market: Market, cartId: string): Promise<CartView | null> {
  const data = await runQuery<{ cart: ShopifyCart | null }>(market, CART_QUERY, { id: cartId });
  return normalize(data?.cart);
}

export async function createCart(
  market: Market,
  lines: Array<{ merchandiseId: string; quantity: number }>,
): Promise<CartView | null> {
  const data = await runQuery<{ cartCreate: CartMutationResult }>(market, CART_CREATE, { lines });
  return normalize(data?.cartCreate?.cart);
}

export async function addLines(
  market: Market,
  cartId: string,
  lines: Array<{ merchandiseId: string; quantity: number }>,
): Promise<CartView | null> {
  const data = await runQuery<{ cartLinesAdd: CartMutationResult }>(market, CART_LINES_ADD, {
    cartId,
    lines,
  });
  return normalize(data?.cartLinesAdd?.cart);
}

export async function updateLine(
  market: Market,
  cartId: string,
  lineId: string,
  quantity: number,
): Promise<CartView | null> {
  const data = await runQuery<{ cartLinesUpdate: CartMutationResult }>(market, CART_LINES_UPDATE, {
    cartId,
    lines: [{ id: lineId, quantity }],
  });
  return normalize(data?.cartLinesUpdate?.cart);
}

export async function removeLine(
  market: Market,
  cartId: string,
  lineId: string,
): Promise<CartView | null> {
  const data = await runQuery<{ cartLinesRemove: CartMutationResult }>(market, CART_LINES_REMOVE, {
    cartId,
    lineIds: [lineId],
  });
  return normalize(data?.cartLinesRemove?.cart);
}
