// Shopify Admin API client — used by the India custom checkout (draft orders) and
// by the customer account (order history + returns + customer lookup) for BOTH the
// India and Global stores. Never import this from client-side code; it carries the
// Admin token. See [[mir-kash-project]].
import type { Money } from '~/types/shopify';
import type { Store } from '~/types/market';

const ADMIN_API_VERSION = '2025-01';

// Per-store env prefixes for the Admin app credentials.
const ENV_PREFIX: Record<Store, string> = {
  india: 'SHOPIFY_IN_ADMIN',
  global: 'SHOPIFY_GL_ADMIN',
};

function getEnv(key: string): string {
  if (typeof process !== 'undefined' && process.env && process.env[key]) {
    return process.env[key] as string;
  }
  const meta = import.meta.env as Record<string, string | undefined>;
  return meta[key] ?? '';
}

function adminDomain(store: Store): string {
  // Admin API uses the *.myshopify.com domain, which differs from the custom
  // storefront domain. Fall back to each store's storefront myshopify domain.
  const fallback = store === 'india' ? getEnv('SHOPIFY_IN_DOMAIN') : getEnv('SHOPIFY_GLOBAL_DOMAIN');
  return getEnv(`${ENV_PREFIX[store]}_DOMAIN`) || fallback;
}

// A static Admin API access token (classic custom app, `shpat_…`), if provided.
// Preferred over the client-credentials grant when present.
function staticToken(store: Store): string {
  return getEnv(`${ENV_PREFIX[store]}_TOKEN`);
}

export function adminConfigured(store: Store): boolean {
  if (!adminDomain(store)) return false;
  if (staticToken(store)) return true;
  return Boolean(getEnv(`${ENV_PREFIX[store]}_CLIENT_ID`) && getEnv(`${ENV_PREFIX[store]}_CLIENT_SECRET`));
}

// Two supported auth modes per store:
//  • a static Admin API token (`SHOPIFY_*_ADMIN_TOKEN`, classic custom app), used directly; or
//  • the client-credentials grant (Client ID + Secret) exchanged for a short-lived
//    (~24h) token, cached per store until it nears expiry.
const tokenCache = new Map<Store, { token: string; expiresAt: number }>();

async function getAdminToken(store: Store): Promise<string | null> {
  const fixed = staticToken(store);
  if (fixed) return fixed;

  const now = Date.now();
  const cached = tokenCache.get(store);
  if (cached && cached.expiresAt > now + 60_000) return cached.token;

  const domain = adminDomain(store);
  const clientId = getEnv(`${ENV_PREFIX[store]}_CLIENT_ID`);
  const clientSecret = getEnv(`${ENV_PREFIX[store]}_CLIENT_SECRET`);
  if (!domain || !clientId || !clientSecret) return null;

  try {
    const res = await fetch(`https://${domain}/admin/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'client_credentials',
      }),
    });
    const json = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!res.ok || !json.access_token) {
      console.error(`[admin:${store}] token exchange failed:`, res.status, JSON.stringify(json));
      return null;
    }
    const entry = { token: json.access_token, expiresAt: now + (json.expires_in ?? 86400) * 1000 };
    tokenCache.set(store, entry);
    return entry.token;
  } catch (err) {
    console.error(`[admin:${store}] token exchange error:`, err);
    return null;
  }
}

export async function runAdminQuery<T>(
  store: Store,
  query: string,
  variables: Record<string, unknown> = {},
): Promise<T | null> {
  const domain = adminDomain(store);
  const token = await getAdminToken(store);
  if (!domain || !token) {
    console.warn(`[admin:${store}] Missing ${ENV_PREFIX[store]}_DOMAIN / CLIENT_ID / CLIENT_SECRET — returning null.`);
    return null;
  }

  try {
    const res = await fetch(`https://${domain}/admin/api/${ADMIN_API_VERSION}/graphql.json`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': token,
      },
      body: JSON.stringify({ query, variables }),
    });
    const json = (await res.json()) as { data?: T; errors?: unknown };
    if (json.errors) {
      console.error(`[admin:${store}] GraphQL errors:`, JSON.stringify(json.errors));
      return null;
    }
    return json.data ?? null;
  } catch (err) {
    console.error(`[admin:${store}] Request failed:`, err);
    return null;
  }
}

// ── Types ─────────────────────────────────────────────────────────────────────
export interface ShippingAddressInput {
  firstName: string;
  lastName: string;
  address1: string;
  address2?: string;
  city: string;
  province: string;
  zip: string;
  phone: string;
  country?: string; // ISO code; defaults to IN
}

export interface DraftLineInput {
  variantId: string; // gid://shopify/ProductVariant/...
  quantity: number;
}

export interface DraftOrderResult {
  id: string;
  name: string;
  status: 'OPEN' | 'INVOICE_SENT' | 'COMPLETED';
  totalPrice: Money;
  orderName: string | null; // set once completed
}

interface RawDraftOrder {
  id: string;
  name: string;
  status: DraftOrderResult['status'];
  totalPriceSet: { shopMoney: Money };
  order: { id: string; name: string } | null;
}

function shape(d: RawDraftOrder | null | undefined): DraftOrderResult | null {
  if (!d) return null;
  return {
    id: d.id,
    name: d.name,
    status: d.status,
    totalPrice: d.totalPriceSet.shopMoney,
    orderName: d.order?.name ?? null,
  };
}

const DRAFT_FIELDS = /* GraphQL */ `
  id
  name
  status
  totalPriceSet { shopMoney { amount currencyCode } }
  order { id name }
`;

// ── Mutations / queries ────────────────────────────────────────────────────────
const DRAFT_ORDER_CREATE = /* GraphQL */ `
  mutation DraftOrderCreate($input: DraftOrderInput!) {
    draftOrderCreate(input: $input) {
      draftOrder { ${DRAFT_FIELDS} }
      userErrors { field message }
    }
  }
`;

const DRAFT_ORDER_COMPLETE = /* GraphQL */ `
  mutation DraftOrderComplete($id: ID!) {
    draftOrderComplete(id: $id, paymentPending: false) {
      draftOrder { ${DRAFT_FIELDS} }
      userErrors { field message }
    }
  }
`;

const DRAFT_ORDER_GET = /* GraphQL */ `
  query DraftOrder($id: ID!) {
    draftOrder(id: $id) { ${DRAFT_FIELDS} }
  }
`;

export async function createDraftOrder(args: {
  lines: DraftLineInput[];
  address: ShippingAddressInput;
  email: string;
  phone: string;
  discount?: { amount: number; title: string }; // fixed ₹ off, from a cart coupon
}): Promise<DraftOrderResult | null> {
  const input: Record<string, unknown> = {
    email: args.email,
    phone: args.phone,
    tags: ['cashfree', 'web-otp'],
    shippingLine: { title: 'Free Shipping', price: '0' },
    lineItems: args.lines.map((l) => ({ variantId: l.variantId, quantity: l.quantity })),
    shippingAddress: {
      firstName: args.address.firstName,
      lastName: args.address.lastName,
      address1: args.address.address1,
      address2: args.address.address2 || '',
      city: args.address.city,
      province: args.address.province,
      zip: args.address.zip,
      phone: args.address.phone,
      countryCode: args.address.country || 'IN',
    },
  };

  // Coupon → a fixed-amount order discount so the charged total matches the cart.
  if (args.discount && args.discount.amount > 0) {
    input.appliedDiscount = {
      valueType: 'FIXED_AMOUNT',
      value: args.discount.amount.toFixed(2),
      title: args.discount.title || 'Discount',
    };
  }

  const data = await runAdminQuery<{
    draftOrderCreate: { draftOrder: RawDraftOrder | null; userErrors: Array<{ message: string }> };
  }>('india', DRAFT_ORDER_CREATE, { input });

  const errs = data?.draftOrderCreate?.userErrors;
  if (errs && errs.length) {
    console.error('[admin] draftOrderCreate userErrors:', JSON.stringify(errs));
    return null;
  }
  return shape(data?.draftOrderCreate?.draftOrder);
}

export async function getDraftOrder(id: string): Promise<DraftOrderResult | null> {
  const data = await runAdminQuery<{ draftOrder: RawDraftOrder | null }>('india', DRAFT_ORDER_GET, { id });
  return shape(data?.draftOrder);
}

// Completes the draft → creates the real (paid) order, decrements inventory,
// sends the Shopify confirmation email. Idempotent: a draft that is already
// COMPLETED is returned as-is rather than re-completed.
export async function completeDraftOrder(id: string): Promise<DraftOrderResult | null> {
  const existing = await getDraftOrder(id);
  if (existing && existing.status === 'COMPLETED') return existing;

  const data = await runAdminQuery<{
    draftOrderComplete: { draftOrder: RawDraftOrder | null; userErrors: Array<{ message: string }> };
  }>('india', DRAFT_ORDER_COMPLETE, { id });

  const errs = data?.draftOrderComplete?.userErrors;
  if (errs && errs.length) {
    console.error('[admin] draftOrderComplete userErrors:', JSON.stringify(errs));
    return existing; // fall back to whatever state we last read
  }
  return shape(data?.draftOrderComplete?.draftOrder);
}

// ── Account: order history + returns + customer lookup ─────────────────────────
export interface AccountOrder {
  store: Store;
  id: string;
  name: string;
  createdAt: string;
  financialStatus: string;
  fulfillmentStatus: string;
  total: Money;
  items: Array<{ title: string; quantity: number }>;
  returnRequested: boolean;
}

export interface ShopifyCustomer {
  full_name: string;
  phone: string;
  address1: string;
  address2: string;
  city: string;
  province: string;
  zip: string;
}

const ORDERS_BY_EMAIL = /* GraphQL */ `
  query OrdersByEmail($q: String!) {
    orders(first: 25, query: $q, sortKey: CREATED_AT, reverse: true) {
      edges { node {
        id name createdAt tags
        displayFinancialStatus displayFulfillmentStatus
        totalPriceSet { shopMoney { amount currencyCode } }
        lineItems(first: 20) { edges { node { title quantity } } }
      } }
    }
  }
`;

interface RawOrder {
  id: string; name: string; createdAt: string; tags: string[];
  displayFinancialStatus: string | null; displayFulfillmentStatus: string | null;
  totalPriceSet: { shopMoney: Money };
  lineItems: { edges: Array<{ node: { title: string; quantity: number } }> };
}

export async function getOrdersByEmail(store: Store, email: string): Promise<AccountOrder[]> {
  if (!email || !adminConfigured(store)) return [];
  const data = await runAdminQuery<{ orders: { edges: Array<{ node: RawOrder }> } }>(
    store,
    ORDERS_BY_EMAIL,
    { q: `email:${email}` },
  );
  return (data?.orders?.edges ?? []).map(({ node }) => ({
    store,
    id: node.id,
    name: node.name,
    createdAt: node.createdAt,
    financialStatus: node.displayFinancialStatus ?? '',
    fulfillmentStatus: node.displayFulfillmentStatus ?? '',
    total: node.totalPriceSet.shopMoney,
    items: node.lineItems.edges.map((e) => ({ title: e.node.title, quantity: e.node.quantity })),
    returnRequested: (node.tags ?? []).includes('return-requested'),
  }));
}

const CUSTOMER_BY_EMAIL = /* GraphQL */ `
  query CustomerByEmail($q: String!) {
    customers(first: 1, query: $q) {
      edges { node {
        firstName lastName phone
        defaultAddress { address1 address2 city province zip phone }
      } }
    }
  }
`;

interface RawCustomer {
  firstName: string | null; lastName: string | null; phone: string | null;
  defaultAddress: {
    address1: string | null; address2: string | null; city: string | null;
    province: string | null; zip: string | null; phone: string | null;
  } | null;
}

// Looks up the customer the shopper created at Shopify checkout, so the account
// can show their name + saved address (Global store has no Firestore profile).
export async function getCustomerByEmail(store: Store, email: string): Promise<ShopifyCustomer | null> {
  if (!email || !adminConfigured(store)) return null;
  const data = await runAdminQuery<{ customers: { edges: Array<{ node: RawCustomer }> } }>(
    store,
    CUSTOMER_BY_EMAIL,
    { q: `email:${email}` },
  );
  const c = data?.customers?.edges?.[0]?.node;
  if (!c) return null;
  const a = c.defaultAddress;
  return {
    full_name: [c.firstName, c.lastName].filter(Boolean).join(' '),
    phone: (a?.phone || c.phone || '').toString(),
    address1: a?.address1 ?? '',
    address2: a?.address2 ?? '',
    city: a?.city ?? '',
    province: a?.province ?? '',
    zip: a?.zip ?? '',
  };
}

const TAGS_ADD = /* GraphQL */ `
  mutation TagsAdd($id: ID!, $tags: [String!]!) {
    tagsAdd(id: $id, tags: $tags) { userErrors { message } }
  }
`;
const ORDER_NOTE = /* GraphQL */ `query OrderNote($id: ID!) { order(id: $id) { note } }`;
const ORDER_UPDATE = /* GraphQL */ `
  mutation OrderUpdate($input: OrderInput!) {
    orderUpdate(input: $input) { userErrors { message } }
  }
`;

// Flags an order for return (tag + appended note) in its own store. Owner processes
// in Shopify.
export async function requestReturn(store: Store, orderId: string, reason: string): Promise<boolean> {
  const tagRes = await runAdminQuery<{ tagsAdd: { userErrors: Array<{ message: string }> } }>(
    store,
    TAGS_ADD,
    { id: orderId, tags: ['return-requested'] },
  );
  if (!tagRes) return false;

  const noteData = await runAdminQuery<{ order: { note: string | null } | null }>(store, ORDER_NOTE, { id: orderId });
  const prev = noteData?.order?.note ?? '';
  const line = `Return requested${reason ? ': ' + reason : ''} (${new Date().toISOString().slice(0, 10)})`;
  await runAdminQuery(store, ORDER_UPDATE, { input: { id: orderId, note: prev ? prev + '\n' + line : line } });
  return true;
}
