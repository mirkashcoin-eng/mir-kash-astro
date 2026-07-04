// Shopify Admin API client for the INDIA store only — used by the custom checkout
// to create + complete draft orders (so Shopify owns the order, computes GST, and
// decrements inventory). Never import this from client-side code; it carries the
// Admin token. See [[mir-kash-project]] India custom checkout plan.
import type { Money } from '~/types/shopify';

const ADMIN_API_VERSION = '2025-01';

function getEnv(key: string): string {
  if (typeof process !== 'undefined' && process.env && process.env[key]) {
    return process.env[key] as string;
  }
  const meta = import.meta.env as Record<string, string | undefined>;
  return meta[key] ?? '';
}

function adminDomain(): string {
  // Admin API uses the *.myshopify.com domain, which differs from the custom
  // storefront domain. Fall back to the storefront domain if not configured.
  return getEnv('SHOPIFY_IN_ADMIN_DOMAIN') || getEnv('SHOPIFY_IN_DOMAIN');
}

// The new Shopify Dev Dashboard no longer hands out a static Admin token. Instead
// we exchange the app's Client ID + Secret for a short-lived (~24h) access token
// via the client-credentials grant, and cache it until just before it expires.
let cachedToken: { token: string; expiresAt: number } | null = null;

async function getAdminToken(): Promise<string | null> {
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt > now + 60_000) return cachedToken.token;

  const domain = adminDomain();
  const clientId = getEnv('SHOPIFY_IN_ADMIN_CLIENT_ID');
  const clientSecret = getEnv('SHOPIFY_IN_ADMIN_CLIENT_SECRET');
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
      console.error('[admin] token exchange failed:', res.status, JSON.stringify(json));
      return null;
    }
    cachedToken = { token: json.access_token, expiresAt: now + (json.expires_in ?? 86400) * 1000 };
    return cachedToken.token;
  } catch (err) {
    console.error('[admin] token exchange error:', err);
    return null;
  }
}

export async function runAdminQuery<T>(
  query: string,
  variables: Record<string, unknown> = {},
): Promise<T | null> {
  const domain = adminDomain();
  const token = await getAdminToken();
  if (!domain || !token) {
    console.warn('[admin] Missing SHOPIFY_IN_ADMIN_DOMAIN / CLIENT_ID / CLIENT_SECRET — returning null.');
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
      console.error('[admin] GraphQL errors:', JSON.stringify(json.errors));
      return null;
    }
    return json.data ?? null;
  } catch (err) {
    console.error('[admin] Request failed:', err);
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
  mutation DraftOrderComplete($id: ID!, $paymentPending: Boolean!) {
    draftOrderComplete(id: $id, paymentPending: $paymentPending) {
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
  optin?: boolean; // customer agreed to WhatsApp order updates
  cod?: boolean; // Cash on Delivery (else Cashfree online payment)
  cfOrderId?: string; // Cashfree order id — stored so the reconciler can recover paid-but-open drafts
}): Promise<DraftOrderResult | null> {
  const payTag = args.cod ? 'cod' : 'cashfree';
  const input: Record<string, unknown> = {
    email: args.email,
    phone: args.phone,
    tags: args.optin ? [payTag, 'web-otp', 'wa-optin'] : [payTag, 'web-otp'],
    // Carries through to the order's note_attributes; the WhatsApp service reads wa_optin.
    customAttributes: [
      ...(args.optin ? [{ key: 'wa_optin', value: 'true' }] : []),
      ...(args.cfOrderId ? [{ key: 'cf_order_id', value: args.cfOrderId }] : []),
    ],
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
  }>(DRAFT_ORDER_CREATE, { input });

  const errs = data?.draftOrderCreate?.userErrors;
  if (errs && errs.length) {
    console.error('[admin] draftOrderCreate userErrors:', JSON.stringify(errs));
    return null;
  }
  return shape(data?.draftOrderCreate?.draftOrder);
}

export async function getDraftOrder(id: string): Promise<DraftOrderResult | null> {
  const data = await runAdminQuery<{ draftOrder: RawDraftOrder | null }>(DRAFT_ORDER_GET, { id });
  return shape(data?.draftOrder);
}

// Completes the draft → creates the real (paid) order, decrements inventory,
// sends the Shopify confirmation email. Idempotent: a draft that is already
// COMPLETED is returned as-is rather than re-completed.
// paymentPending=false → real PAID order (online). paymentPending=true → order marked
// "Payment pending" (Cash on Delivery — collect cash on delivery, then mark paid in Shopify).
export async function completeDraftOrder(id: string, paymentPending = false): Promise<DraftOrderResult | null> {
  const existing = await getDraftOrder(id);
  if (existing && existing.status === 'COMPLETED') return existing;

  const data = await runAdminQuery<{
    draftOrderComplete: { draftOrder: RawDraftOrder | null; userErrors: Array<{ message: string }> };
  }>(DRAFT_ORDER_COMPLETE, { id, paymentPending });

  const errs = data?.draftOrderComplete?.userErrors;
  if (errs && errs.length) {
    console.error('[admin] draftOrderComplete userErrors:', JSON.stringify(errs));
    return existing; // fall back to whatever state we last read
  }
  return shape(data?.draftOrderComplete?.draftOrder);
}

// ── Account: order history + returns ───────────────────────────────────────────
export interface AccountOrder {
  id: string;
  name: string;
  createdAt: string;
  financialStatus: string;
  fulfillmentStatus: string;
  cancelledAt: string | null;
  total: Money;
  items: Array<{ title: string; quantity: number; image: string | null; variantId: string | null; price: Money | null }>;
  returnRequested: boolean;
  // Shipment tracking (populated once the order is fulfilled)
  shipmentStatus: string | null; // Shopify FulfillmentDisplayStatus (IN_TRANSIT, OUT_FOR_DELIVERY, DELIVERED…)
  estimatedDeliveryAt: string | null;
  deliveredAt: string | null; // actual delivery date, from the DELIVERED fulfillment event
  shippedAt: string | null; // fulfillment created date
  tracking: { company: string | null; number: string | null; url: string | null } | null;
  // Price breakdown + contact/shipping (for the order-summary detail view)
  subtotal: Money | null;
  shipping: Money | null;
  discount: Money | null;
  email: string | null;
  phone: string | null;
  address: { name: string | null; address1: string | null; address2: string | null; city: string | null; province: string | null; zip: string | null } | null;
}

const ORDERS_BY_EMAIL = /* GraphQL */ `
  query OrdersByEmail($q: String!) {
    orders(first: 25, query: $q, sortKey: CREATED_AT, reverse: true) {
      edges { node {
        id name createdAt tags cancelledAt email phone
        displayFinancialStatus displayFulfillmentStatus
        totalPriceSet { shopMoney { amount currencyCode } }
        subtotalPriceSet { shopMoney { amount currencyCode } }
        totalShippingPriceSet { shopMoney { amount currencyCode } }
        totalDiscountsSet { shopMoney { amount currencyCode } }
        shippingAddress { name address1 address2 city province zip }
        lineItems(first: 20) { edges { node {
          title quantity
          image { url }
          originalUnitPriceSet { shopMoney { amount currencyCode } }
        } } }
        fulfillments(first: 1) {
          createdAt
          displayStatus
          estimatedDeliveryAt
          trackingInfo(first: 1) { company number url }
          events(first: 20) { edges { node { status happenedAt } } }
        }
      } }
    }
  }
`;

interface RawOrder {
  id: string; name: string; createdAt: string; tags: string[]; cancelledAt: string | null;
  email: string | null; phone: string | null;
  displayFinancialStatus: string | null; displayFulfillmentStatus: string | null;
  totalPriceSet: { shopMoney: Money };
  subtotalPriceSet: { shopMoney: Money } | null;
  totalShippingPriceSet: { shopMoney: Money } | null;
  totalDiscountsSet: { shopMoney: Money } | null;
  shippingAddress: { name: string | null; address1: string | null; address2: string | null; city: string | null; province: string | null; zip: string | null } | null;
  lineItems: { edges: Array<{ node: {
    title: string; quantity: number;
    image: { url: string } | null;
    originalUnitPriceSet: { shopMoney: Money } | null;
  } }> };
  fulfillments: Array<{
    createdAt: string | null;
    displayStatus: string | null;
    estimatedDeliveryAt: string | null;
    trackingInfo: Array<{ company: string | null; number: string | null; url: string | null }>;
    events: { edges: Array<{ node: { status: string; happenedAt: string } }> };
  }>;
}

export async function getOrdersByEmail(email: string): Promise<AccountOrder[]> {
  if (!email) return [];
  const data = await runAdminQuery<{ orders: { edges: Array<{ node: RawOrder }> } }>(
    ORDERS_BY_EMAIL,
    { q: `email:${email}` },
  );
  return (data?.orders?.edges ?? []).map(({ node }) => ({
    id: node.id,
    name: node.name,
    createdAt: node.createdAt,
    financialStatus: node.displayFinancialStatus ?? '',
    fulfillmentStatus: node.displayFulfillmentStatus ?? '',
    cancelledAt: node.cancelledAt,
    total: node.totalPriceSet.shopMoney,
    items: node.lineItems.edges.map((e) => ({
      title: e.node.title,
      quantity: e.node.quantity,
      image: e.node.image?.url ?? null,
      // variant id needs the read_products scope; null until that's added (disables reorder)
      variantId: null,
      price: e.node.originalUnitPriceSet?.shopMoney ?? null,
    })),
    returnRequested: (node.tags ?? []).includes('return-requested'),
    shipmentStatus: node.fulfillments?.[0]?.displayStatus ?? null,
    estimatedDeliveryAt: node.fulfillments?.[0]?.estimatedDeliveryAt ?? null,
    deliveredAt: node.fulfillments?.[0]?.events?.edges?.find(
      (e) => (e.node.status || '').toUpperCase() === 'DELIVERED',
    )?.node.happenedAt ?? null,
    shippedAt: node.fulfillments?.[0]?.createdAt ?? null,
    subtotal: node.subtotalPriceSet?.shopMoney ?? null,
    shipping: node.totalShippingPriceSet?.shopMoney ?? null,
    discount: node.totalDiscountsSet?.shopMoney ?? null,
    email: node.email,
    phone: node.phone ?? null,
    address: node.shippingAddress
      ? {
          name: node.shippingAddress.name,
          address1: node.shippingAddress.address1,
          address2: node.shippingAddress.address2,
          city: node.shippingAddress.city,
          province: node.shippingAddress.province,
          zip: node.shippingAddress.zip,
        }
      : null,
    tracking: node.fulfillments?.[0]?.trackingInfo?.[0]
      ? {
          company: node.fulfillments[0].trackingInfo[0].company,
          number: node.fulfillments[0].trackingInfo[0].number,
          url: node.fulfillments[0].trackingInfo[0].url,
        }
      : null,
  }));
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

// Flags an order for return (tag + appended note). Owner processes in Shopify.
export async function requestReturn(orderId: string, reason: string): Promise<boolean> {
  const tagRes = await runAdminQuery<{ tagsAdd: { userErrors: Array<{ message: string }> } }>(
    TAGS_ADD,
    { id: orderId, tags: ['return-requested'] },
  );
  if (!tagRes) return false;

  const noteData = await runAdminQuery<{ order: { note: string | null } | null }>(ORDER_NOTE, { id: orderId });
  const prev = noteData?.order?.note ?? '';
  const line = `Return requested${reason ? ': ' + reason : ''} (${new Date().toISOString().slice(0, 10)})`;
  await runAdminQuery(ORDER_UPDATE, { input: { id: orderId, note: prev ? prev + '\n' + line : line } });
  return true;
}

const ORDER_CANCEL = /* GraphQL */ `
  mutation OrderCancel($orderId: ID!, $reason: OrderCancelReason!, $refund: Boolean!, $restock: Boolean!, $notifyCustomer: Boolean) {
    orderCancel(orderId: $orderId, reason: $reason, refund: $refund, restock: $restock, notifyCustomer: $notifyCustomer) {
      job { id }
      orderCancelUserErrors { field message }
    }
  }
`;

// Cancels an unfulfilled order at the customer's request (restocks + emails the customer).
// We never auto-refund through Shopify: a prepaid (Cashfree) order is flagged `refund-pending`
// with a note so the team pushes the Cashfree refund by hand; a COD order owes nothing.
export async function cancelOrder(
  orderId: string,
  opts: { refundPending?: boolean } = {},
): Promise<boolean> {
  if (opts.refundPending) {
    await runAdminQuery(TAGS_ADD, { id: orderId, tags: ['refund-pending'] });
    const noteData = await runAdminQuery<{ order: { note: string | null } | null }>(ORDER_NOTE, { id: orderId });
    const prev = noteData?.order?.note ?? '';
    const line = `Cancelled by customer — process Cashfree refund (${new Date().toISOString().slice(0, 10)})`;
    await runAdminQuery(ORDER_UPDATE, { input: { id: orderId, note: prev ? prev + '\n' + line : line } });
  }

  const data = await runAdminQuery<{
    orderCancel: { job: { id: string } | null; orderCancelUserErrors: Array<{ message: string }> };
  }>(ORDER_CANCEL, { orderId, reason: 'CUSTOMER', refund: false, restock: true, notifyCustomer: true });

  const errs = data?.orderCancel?.orderCancelUserErrors;
  if (errs && errs.length) {
    console.error('[admin] orderCancel userErrors:', JSON.stringify(errs));
    return false;
  }
  return !!data?.orderCancel?.job;
}

// ── Reconciliation: open drafts that carry a Cashfree order id ──────────────────
export interface OpenDraft {
  id: string;
  name: string;
  cfOrderId: string | null;
}

const OPEN_DRAFTS = /* GraphQL */ `
  query OpenDrafts {
    draftOrders(first: 60, query: "status:open", sortKey: UPDATED_AT, reverse: true) {
      edges { node { id name customAttributes { key value } } }
    }
  }
`;

// Lists OPEN (uncompleted) draft orders with their stored Cashfree order id, so the
// reconciler can complete any that were actually paid (e.g. UPI, buyer never returned).
export async function getOpenDrafts(): Promise<OpenDraft[]> {
  const data = await runAdminQuery<{
    draftOrders: { edges: Array<{ node: { id: string; name: string; customAttributes: Array<{ key: string; value: string }> } }> };
  }>(OPEN_DRAFTS);
  return (data?.draftOrders?.edges ?? []).map(({ node }) => ({
    id: node.id,
    name: node.name,
    cfOrderId: node.customAttributes.find((a) => a.key === 'cf_order_id')?.value ?? null,
  }));
}
