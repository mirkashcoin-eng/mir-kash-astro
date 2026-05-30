import { atom, map } from 'nanostores';
import type { Market } from '~/types/market';

export interface CartLine {
  id: string;
  merchandiseId: string;
  quantity: number;
  title: string;
  variantTitle?: string;
  price: number;
  image?: string;
}

export interface CartData {
  id: string;
  checkoutUrl: string;
  lines: CartLine[];
  subtotal: number;
  total: number;
  currency: string;
}

export const cartIdByMarket = map<Record<Market, string | null>>({
  global: null,
  india: null,
});

export const cartDataByMarket = map<Record<Market, CartData | null>>({
  global: null,
  india: null,
});

export const drawerOpen = atom(false);
export const activeMarket = atom<Market>('global');

export function openDrawer() {
  drawerOpen.set(true);
}
export function closeDrawer() {
  drawerOpen.set(false);
}
