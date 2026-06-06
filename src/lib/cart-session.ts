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
