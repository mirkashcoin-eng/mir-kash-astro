import type { APIRoute } from 'astro';
import { getCart } from '~/lib/shopify/cart';
import { resolveMarket, getCartId, persistCart, clearCart } from '~/lib/cart-session';

export const prerender = false;

const EMPTY = {
  id: '',
  checkoutUrl: '',
  totalQuantity: 0,
  subtotal: 0,
  total: 0,
  currency: '',
  lines: [] as unknown[],
};

export const GET: APIRoute = async ({ url, cookies }) => {
  const market = resolveMarket(url.searchParams.get('market'));
  const cartId = getCartId(cookies, market);

  if (!cartId) {
    return Response.json(EMPTY);
  }

  const cart = await getCart(market, cartId);
  if (!cart) {
    // Stored cart no longer valid — clear it so we start fresh next add.
    clearCart(cookies, market);
    return Response.json(EMPTY);
  }

  persistCart(cookies, market, cart);
  return Response.json(cart);
};
