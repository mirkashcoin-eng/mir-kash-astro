import type { AstroCookies } from 'astro';
import type { Market } from '~/types/market';
import type { CartView } from '~/types/shopify';
import { DEFAULT_MARKET } from '~/lib/markets';

const MAX_AGE = 60 * 60 * 24 * 30; // 30 days

const cookieOpts = {
  path: '/',
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: import.meta.env.PROD,
  maxAge: MAX_AGE,
};

export function resolveMarket(value: unknown): Market {
  return value === 'us' ? 'us' : value === 'india' ? 'india' : DEFAULT_MARKET;
}

export function cartIdCookieName(market: Market): string {
  return `mk_cart_${market}`;
}

export function countCookieName(market: Market): string {
  return `mk_cart_count_${market}`;
}

export function getCartId(cookies: AstroCookies, market: Market): string | null {
  return cookies.get(cartIdCookieName(market))?.value ?? null;
}

export function getCartCount(cookies: AstroCookies, market: Market): number {
  const raw = cookies.get(countCookieName(market))?.value;
  const n = raw ? parseInt(raw, 10) : 0;
  return Number.isFinite(n) ? n : 0;
}

export function persistCart(cookies: AstroCookies, market: Market, cart: CartView | null): void {
  if (!cart) return;
  cookies.set(cartIdCookieName(market), cart.id, cookieOpts);
  cookies.set(countCookieName(market), String(cart.totalQuantity), cookieOpts);
}

export function clearCart(cookies: AstroCookies, market: Market): void {
  cookies.delete(cartIdCookieName(market), { path: '/' });
  cookies.delete(countCookieName(market), { path: '/' });
}
