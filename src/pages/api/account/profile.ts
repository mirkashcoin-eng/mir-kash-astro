import type { APIRoute } from 'astro';
import type { Store } from '~/types/market';
import { verifyFirebaseUser } from '~/lib/firebaseAuth';
import { getCustomerByEmail } from '~/lib/shopify/admin';

export const prerender = false;

const STORES: Store[] = ['india', 'global'];

// Falls back to the customer's Shopify record (name + saved address) when there's
// no Firestore profile — e.g. a Global-store customer who only ever used Shopify's
// hosted checkout. Auth = a Firebase ID token; matched by the verified email.
export const GET: APIRoute = async ({ request }) => {
  const token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  const user = await verifyFirebaseUser(token);
  if (!user) return new Response(JSON.stringify({ error: 'Not signed in' }), { status: 401 });

  let customer = null;
  for (const store of STORES) {
    customer = await getCustomerByEmail(store, user.email);
    if (customer && (customer.full_name || customer.address1)) break;
  }

  return new Response(
    JSON.stringify(customer ? { found: true, ...customer } : { found: false }),
    { status: 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store' } },
  );
};
