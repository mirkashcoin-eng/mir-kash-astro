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

// Money is rounded to paise at the source so the figure we display, the figure we
// store, and the figure Shopify receives (admin.ts does .toFixed(2)) are the same.
const r2 = (n: number) => Math.round(n * 100) / 100;

function normalize(cart: ShopifyCart | null | undefined): CartView | null {
  if (!cart) return null;
  const lines = cart.lines.edges.map(({ node }) => ({
    id: node.id,
    merchandiseId: node.merchandise.id,
    quantity: node.quantity,
    title: node.merchandise.product.title,
    variantTitle: node.merchandise.title,
    handle: node.merchandise.product.handle,
    price: Number(node.merchandise.price.amount),
    // GROSS (price × qty), deliberately not node.cost.totalAmount — that one is net
    // of line-level discounts, which would make the line prices quietly drop with no
    // Discount row explaining why, and stop the summary from adding up.
    lineTotal: r2(Number(node.merchandise.price.amount) * node.quantity),
    image: node.merchandise.image?.url ?? null,
  }));

  // Deliberately NOT cart.cost.subtotalAmount. Shopify defines that as "before taxes
  // and CART-level discounts" — a product-scoped code (the common kind, and how BXGY
  // and automatic discounts work) allocates at the LINE level and is already netted
  // out of it, so subtotal − total came to 0 and the coupon never reached the draft
  // order. Summing the gross line totals is also exactly what the draft order prices
  // line items at, so `discountAmount` below makes the draft total equal `total` by
  // construction. Don't "simplify" this back to cost.subtotalAmount.
  const subtotal = r2(lines.reduce((s, l) => s + l.lineTotal, 0));
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
    discountAmount: r2(Math.max(0, subtotal - total)),
    lines,
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
