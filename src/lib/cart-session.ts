import type { AstroCookies } from 'astro';
import type { Store } from '~/types/market';
import type { CartView } from '~/types/shopify';

const MAX_AGE = 60 * 60 * 24 * 30; // 30 days

const cookieOpts = {
  path: '/',
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: import.meta.env.PROD,
  maxAge: MAX_AGE,
};

// Carts are per Shopify store (india | global).
export function resolveStore(value: unknown): Store {
  return value === 'global' ? 'global' : 'india';
}

export function cartIdCookieName(store: Store): string {
  return `mk_cart_${store}`;
}

export function countCookieName(store: Store): string {
  return `mk_cart_count_${store}`;
}

export function getCartId(cookies: AstroCookies, store: Store): string | null {
  return cookies.get(cartIdCookieName(store))?.value ?? null;
}

export function getCartCount(cookies: AstroCookies, store: Store): number {
  const raw = cookies.get(countCookieName(store))?.value;
  const n = raw ? parseInt(raw, 10) : 0;
  return Number.isFinite(n) ? n : 0;
}

export function persistCart(cookies: AstroCookies, store: Store, cart: CartView | null): void {
  if (!cart) return;
  cookies.set(cartIdCookieName(store), cart.id, cookieOpts);
  cookies.set(countCookieName(store), String(cart.totalQuantity), cookieOpts);
}

export function clearCart(cookies: AstroCookies, store: Store): void {
  cookies.delete(cartIdCookieName(store), { path: '/' });
  cookies.delete(countCookieName(store), { path: '/' });
}

// ── Buy-now cart (Amazon-style express checkout) ──────────────────────────────
// A separate single-item cart so "Buy Now" never disturbs the main cart.
export function buyNowCartIdCookieName(store: Store): string {
  return `mk_buynow_${store}`;
}

export function getBuyNowCartId(cookies: AstroCookies, store: Store): string | null {
  return cookies.get(buyNowCartIdCookieName(store))?.value ?? null;
}

export function persistBuyNowCart(cookies: AstroCookies, store: Store, cart: CartView | null): void {
  if (!cart) return;
  cookies.set(buyNowCartIdCookieName(store), cart.id, cookieOpts);
}

export function clearBuyNowCart(cookies: AstroCookies, store: Store): void {
  cookies.delete(buyNowCartIdCookieName(store), { path: '/' });
}

// The cart the checkout is operating on: buy-now (single item) or the main cart.
export function resolveCheckoutCartId(
  cookies: AstroCookies,
  store: Store,
  isBuyNow: boolean,
): string | null {
  return isBuyNow ? getBuyNowCartId(cookies, store) : getCartId(cookies, store);
}
