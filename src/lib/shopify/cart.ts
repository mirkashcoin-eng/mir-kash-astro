import { runQuery } from './client';
import { IMAGE_FRAGMENT, MONEY_FRAGMENT, CART_FRAGMENT } from './fragments';
import type { Store } from '~/types/market';
import type { ShopifyCart, CartView } from '~/types/shopify';

const FRAGMENTS = `${IMAGE_FRAGMENT}${MONEY_FRAGMENT}${CART_FRAGMENT}`;

const CART_QUERY = /* GraphQL */ `
  ${FRAGMENTS}
  query Cart($id: ID!, $country: CountryCode) @inContext(country: $country) {
    cart(id: $id) { ...CartFields }
  }
`;

const CART_CREATE = /* GraphQL */ `
  ${FRAGMENTS}
  mutation CartCreate($lines: [CartLineInput!], $country: CountryCode) @inContext(country: $country) {
    cartCreate(input: { lines: $lines, buyerIdentity: { countryCode: $country } }) {
      cart { ...CartFields }
      userErrors { field message }
    }
  }
`;

const CART_BUYER_IDENTITY_UPDATE = /* GraphQL */ `
  ${FRAGMENTS}
  mutation CartBuyerIdentityUpdate($cartId: ID!, $country: CountryCode) @inContext(country: $country) {
    cartBuyerIdentityUpdate(cartId: $cartId, buyerIdentity: { countryCode: $country }) {
      cart { ...CartFields }
      userErrors { field message }
    }
  }
`;

const CART_LINES_ADD = /* GraphQL */ `
  ${FRAGMENTS}
  mutation CartLinesAdd($cartId: ID!, $lines: [CartLineInput!]!, $country: CountryCode) @inContext(country: $country) {
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

const CART_DISCOUNT_UPDATE = /* GraphQL */ `
  ${FRAGMENTS}
  mutation CartDiscountCodesUpdate($cartId: ID!, $codes: [String!]!, $country: CountryCode) @inContext(country: $country) {
    cartDiscountCodesUpdate(cartId: $cartId, discountCodes: $codes) {
      cart { ...CartFields }
      userErrors { field message }
    }
  }
`;

// Apply (or clear, with []) discount codes on the cart. Returns the updated cart
// plus whether the FIRST submitted code is actually applicable (valid).
export async function applyDiscount(
  store: Store,
  cartId: string,
  codes: string[],
  countryCode?: string,
): Promise<{ cart: CartView | null; applied: boolean }> {
  const data = await runQuery<{ cartDiscountCodesUpdate: CartMutationResult }>(
    store,
    CART_DISCOUNT_UPDATE,
    { cartId, codes, country: countryCode ?? null },
  );
  const raw = data?.cartDiscountCodesUpdate?.cart ?? null;
  const want = (codes[0] ?? '').toUpperCase();
  const applied = !!raw?.discountCodes?.some((d) => d.applicable && d.code.toUpperCase() === want);
  return { cart: normalize(raw), applied };
}

function normalize(cart: ShopifyCart | null | undefined): CartView | null {
  if (!cart) return null;
  const subtotal = Number(cart.cost.subtotalAmount.amount);
  const total = Number(cart.cost.totalAmount.amount);
  const applied = (cart.discountCodes ?? []).find((d) => d.applicable);
  return {
    id: cart.id,
    checkoutUrl: cart.checkoutUrl,
    totalQuantity: cart.totalQuantity,
    subtotal,
    total,
    currency: cart.cost.totalAmount.currencyCode,
    discountCode: applied?.code ?? null,
    discountAmount: Math.max(0, subtotal - total),
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

export async function getCart(store: Store, cartId: string, countryCode?: string): Promise<CartView | null> {
  const data = await runQuery<{ cart: ShopifyCart | null }>(store, CART_QUERY, {
    id: cartId,
    country: countryCode ?? null,
  });
  return normalize(data?.cart);
}

export async function createCart(
  store: Store,
  lines: Array<{ merchandiseId: string; quantity: number }>,
  countryCode?: string,
): Promise<CartView | null> {
  const data = await runQuery<{ cartCreate: CartMutationResult }>(store, CART_CREATE, {
    lines,
    country: countryCode ?? null,
  });
  return normalize(data?.cartCreate?.cart);
}

export async function updateBuyerIdentity(
  store: Store,
  cartId: string,
  countryCode: string,
): Promise<CartView | null> {
  const data = await runQuery<{ cartBuyerIdentityUpdate: CartMutationResult }>(
    store,
    CART_BUYER_IDENTITY_UPDATE,
    { cartId, country: countryCode },
  );
  return normalize(data?.cartBuyerIdentityUpdate?.cart);
}

export async function addLines(
  store: Store,
  cartId: string,
  lines: Array<{ merchandiseId: string; quantity: number }>,
  countryCode?: string,
): Promise<CartView | null> {
  const data = await runQuery<{ cartLinesAdd: CartMutationResult }>(store, CART_LINES_ADD, {
    cartId,
    lines,
    country: countryCode ?? null,
  });
  return normalize(data?.cartLinesAdd?.cart);
}

export async function updateLine(
  store: Store,
  cartId: string,
  lineId: string,
  quantity: number,
): Promise<CartView | null> {
  const data = await runQuery<{ cartLinesUpdate: CartMutationResult }>(store, CART_LINES_UPDATE, {
    cartId,
    lines: [{ id: lineId, quantity }],
  });
  return normalize(data?.cartLinesUpdate?.cart);
}

export async function removeLine(
  store: Store,
  cartId: string,
  lineId: string,
): Promise<CartView | null> {
  const data = await runQuery<{ cartLinesRemove: CartMutationResult }>(store, CART_LINES_REMOVE, {
    cartId,
    lineIds: [lineId],
  });
  return normalize(data?.cartLinesRemove?.cart);
}
