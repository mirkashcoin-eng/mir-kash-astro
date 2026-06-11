import type { APIRoute } from 'astro';
import { getCart } from '~/lib/shopify/cart';
import { resolveStore, getCartId, persistCart, clearCart } from '~/lib/cart-session';

export const prerender = false;

const EMPTY = {
  id: '',
  checkoutUrl: '',
  totalQuantity: 0,
  subtotal: 0,
  total: 0,
  currency: '',
  discountCode: null,
  discountAmount: 0,
  lines: [] as unknown[],
};

const NO_STORE = { 'Cache-Control': 'private, no-store' };

export const GET: APIRoute = async ({ url, cookies }) => {
  const store = resolveStore(url.searchParams.get('store'));
  const cartId = getCartId(cookies, store);

  if (!cartId) {
    return Response.json(EMPTY, { headers: NO_STORE });
  }

  const cart = await getCart(store, cartId);
  if (!cart) {
    clearCart(cookies, store);
    return Response.json(EMPTY, { headers: NO_STORE });
  }

  persistCart(cookies, store, cart);
  return Response.json(cart, { headers: NO_STORE });
};
