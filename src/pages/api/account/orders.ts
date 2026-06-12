import type { APIRoute } from 'astro';
import type { Store } from '~/types/market';
import { verifyFirebaseUser } from '~/lib/firebaseAuth';
import { getOrdersByEmail } from '~/lib/shopify/admin';

export const prerender = false;

const STORES: Store[] = ['india', 'global'];

// Returns the signed-in customer's orders, aggregated across BOTH Shopify stores
// (India + Global) and keyed by the verified email. Auth = a Firebase ID token in
// the Authorization header. Each store no-ops unless its Admin app is configured.
export const GET: APIRoute = async ({ request }) => {
  const token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  const user = await verifyFirebaseUser(token);
  if (!user) return new Response(JSON.stringify({ error: 'Not signed in' }), { status: 401 });

  const lists = await Promise.all(STORES.map((s) => getOrdersByEmail(s, user.email)));
  const orders = lists.flat().sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));

  return new Response(JSON.stringify({ orders }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store' },
  });
};
