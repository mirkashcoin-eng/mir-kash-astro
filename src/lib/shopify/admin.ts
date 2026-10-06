// Shopify Admin API client for the INDIA store only — used by the custom checkout
// to create + complete draft orders (so Shopify owns the order, computes GST, and
// decrements inventory). Never import this from client-side code; it carries the
// Admin token. See [[mir-kash-project]] India custom checkout plan.
import type { Money } from '~/types/shopify';
import { sendMetaEvent } from '~/lib/meta-capi';
import { SITE_ORIGIN } from '~/lib/markets';

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
  orderId: string | null; // real Order GID, set once completed
  items: Array<{ title: string; quantity: number; image: string | null; price: Money | null }>;
  phone: string | null;        // for the instant WhatsApp order confirmation
  email: string | null;        // buyer identity for the coupon redemption ledger
  waOptin: boolean;            // customer ticked "order updates on WhatsApp"
  customerName: string | null; // shipping first name, for the greeting
  // The coupon code used, stamped as a custom attribute so it survives even when the
  // discount is worth ₹0 (free shipping on already-free shipping) and no
  // appliedDiscount is attached. This is what finalizeOrder ledgers.
  discountCode: string | null;
  discount: { title: string; amount: Money } | null;
}

interface RawDraftOrder {
  id: string;
  name: string;
  status: DraftOrderResult['status'];
  totalPriceSet: { shopMoney: Money };
  order: { id: string; name: string } | null;
  phone: string | null;
  email: string | null;
  appliedDiscount: { title: string | null; amountSet: { shopMoney: Money } } | null;
  customAttributes: Array<{ key: string; value: string }>;
  shippingAddress: { firstName: string | null; name: string | null } | null;
  lineItems: { edges: Array<{ node: {
    title: string; quantity: number;
    image: { url: string } | null;
    originalUnitPriceSet: { shopMoney: Money } | null;
  } }> };
}

function shape(d: RawDraftOrder | null | undefined): DraftOrderResult | null {
  if (!d) return null;
  return {
    id: d.id,
    name: d.name,
    status: d.status,
    totalPrice: d.totalPriceSet.shopMoney,
    orderName: d.order?.name ?? null,
    orderId: d.order?.id ?? null,
    items: (d.lineItems?.edges ?? []).map((e) => ({
      title: e.node.title,
      quantity: e.node.quantity,
      image: e.node.image?.url ?? null,
      price: e.node.originalUnitPriceSet?.shopMoney ?? null,
    })),
    phone: d.phone ?? null,
    email: d.email ?? null,
    waOptin: (d.customAttributes ?? []).some((a) => a.key === 'wa_optin' && a.value === 'true'),
    customerName: d.shippingAddress?.firstName ?? d.shippingAddress?.name ?? null,
    discountCode: (d.customAttributes ?? []).find((a) => a.key === 'discount_code')?.value ?? null,
    discount: d.appliedDiscount
      ? { title: d.appliedDiscount.title ?? 'Discount', amount: d.appliedDiscount.amountSet.shopMoney }
      : null,
  };
}

const DRAFT_FIELDS = /* GraphQL */ `
  id
  name
  status
  totalPriceSet { shopMoney { amount currencyCode } }
  order { id name }
  phone
  email
  appliedDiscount { title amountSet { shopMoney { amount currencyCode } } }
  customAttributes { key value }
  shippingAddress { firstName name }
  lineItems(first: 20) { edges { node {
    title quantity
    image { url }
    originalUnitPriceSet { shopMoney { amount currencyCode } }
  } } }
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

// ── Discount code rules ────────────────────────────────────────────────────────
// The India checkout never *redeems* a code — createDraftOrder re-expresses the
// coupon as a manual FIXED_AMOUNT discount (Shopify's DraftOrderInput has no
// discount-code field, and the Admin API has no "redeem" mutation). So Shopify's
// own usage counter never moves, and "limit total uses" / "one per customer" go
// unenforced on India orders. We read the rules here and count redemptions
// ourselves in lib/coupons.ts. See [[india-coupon-redemption-ledger]].

export interface DiscountCodeRules {
  usageLimit: number | null;       // null = uncapped
  appliesOncePerCustomer: boolean;
  asyncUsageCount: number;         // Shopify's own count (hosted checkout / manual drafts)
}

// codeDiscount is a union; all three code-discount types carry the same usage fields.
const DISCOUNT_BY_CODE = /* GraphQL */ `
  query DiscountByCode($code: String!) {
    codeDiscountNodeByCode(code: $code) {
      id
      codeDiscount {
        ... on DiscountCodeBasic        { usageLimit appliesOncePerCustomer asyncUsageCount }
        ... on DiscountCodeBxgy         { usageLimit appliesOncePerCustomer asyncUsageCount }
        ... on DiscountCodeFreeShipping { usageLimit appliesOncePerCustomer asyncUsageCount }
      }
    }
  }
`;

// Rules change rarely but this runs on every Apply click, so cache briefly.
const rulesCache = new Map<string, { at: number; rules: DiscountCodeRules | null }>();
const RULES_TTL_MS = 60_000;

export async function getDiscountCodeRules(code: string): Promise<DiscountCodeRules | null> {
  const key = code.trim().toUpperCase();
  if (!key) return null;
  const hit = rulesCache.get(key);
  if (hit && Date.now() - hit.at < RULES_TTL_MS) return hit.rules;

  const data = await runAdminQuery<{
    codeDiscountNodeByCode: { id: string; codeDiscount: Partial<DiscountCodeRules> } | null;
  }>(DISCOUNT_BY_CODE, { code: key });

  const raw = data?.codeDiscountNodeByCode?.codeDiscount;
  // An automatic discount has no code, and a union member we didn't fragment on
  // comes back as {} — both mean "no code-level limits to enforce".
  const rules: DiscountCodeRules | null = raw && typeof raw.asyncUsageCount === 'number'
    ? {
        usageLimit: typeof raw.usageLimit === 'number' ? raw.usageLimit : null,
        appliesOncePerCustomer: raw.appliesOncePerCustomer === true,
        asyncUsageCount: raw.asyncUsageCount,
      }
    : null;

  rulesCache.set(key, { at: Date.now(), rules });
  return rules;
}

export async function createDraftOrder(args: {
  lines: DraftLineInput[];
  address: ShippingAddressInput;
  email: string;
  phone: string;
  discount?: { amount: number; title: string }; // fixed ₹ off, from a cart coupon
  discountCode?: string; // the coupon code itself — stamped even when it's worth ₹0
  optin?: boolean; // customer agreed to WhatsApp order updates
  cod?: boolean; // Cash on Delivery (else Cashfree online payment)
  cfOrderId?: string; // Cashfree order id — stored so the reconciler can recover paid-but-open drafts
  clickId?: string; // affiliate click id (from the mk_click cookie), if the visitor came via /go/*
}): Promise<DraftOrderResult | null> {
  const payTag = args.cod ? 'cod' : 'cashfree';
  const input: Record<string, unknown> = {
    email: args.email,
    phone: args.phone,
    tags: args.optin ? [payTag, 'web-otp', 'wa-optin'] : [payTag, 'web-otp'],
    // Carries through to the order's note_attributes; the WhatsApp service reads wa_optin,
    // and click_id is what ties the sale back to an affiliate.
    customAttributes: [
      ...(args.optin ? [{ key: 'wa_optin', value: 'true' }] : []),
      ...(args.cfOrderId ? [{ key: 'cf_order_id', value: args.cfOrderId }] : []),
      ...(args.discountCode ? [{ key: 'discount_code', value: args.discountCode }] : []),
      ...(args.clickId ? [{ key: 'click_id', value: args.clickId }] : []),
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
  // `value` is Float! in the Admin schema — a string ("500.00") is rejected outright
  // with "Could not coerce value to Float", which fails the whole draftOrderCreate
  // and surfaces to the buyer as "Payment could not be started". Send a number.
  if (args.discount && args.discount.amount > 0) {
    input.appliedDiscount = {
      valueType: 'FIXED_AMOUNT',
      value: Math.round(args.discount.amount * 100) / 100,
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

// Shown in Shopify order search/list (tag) and prominently on the order page (note).
// financial_status alone can't tell COD from Cashfree once a COD order is later marked
// paid by hand — both just say "Paid" — so this stamps the *original* payment method as
// a permanent record, independent of whatever the financial status becomes later.
const PAYMENT_LABEL: Record<'cod' | 'cashfree', string> = {
  cod: 'Cash on Delivery — mark this order Paid in Shopify once cash is collected.',
  cashfree: 'Paid online via Cashfree.',
};

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
  const result = shape(data?.draftOrderComplete?.draftOrder);

  // Draft-order tags aren't reliably carried over onto the real Order by
  // draftOrderComplete, so re-apply the payment-method tag + note directly on the
  // Order once it exists, rather than trusting the draft's tags to survive.
  if (result?.orderId) {
    const payTag: 'cod' | 'cashfree' = paymentPending ? 'cod' : 'cashfree';
    await runAdminQuery(TAGS_ADD, { id: result.orderId, tags: [payTag] });
    await runAdminQuery(ORDER_UPDATE, { input: { id: result.orderId, note: `Payment: ${PAYMENT_LABEL[payTag]}` } });
  }

  // Meta Conversions API — server-side mirror of the browser Purchase pixel (same
  // event_id as the orderName used client-side in checkout/return.astro, so Meta dedupes
  // the two instead of double-counting). Fires exactly once per order: this code only
  // runs past the early "already COMPLETED" return above, and every completion path
  // (COD, Cashfree webhook, the return page, the cron recovery job) converges here.
  if (result?.orderName) {
    await sendMetaEvent({
      eventName: 'Purchase',
      eventId: result.orderName,
      sourceUrl: `${SITE_ORIGIN}/checkout/return`,
      user: { email: result.email, phone: result.phone, externalId: result.orderName },
      customData: {
        currency: result.totalPrice.currencyCode,
        value: Number(result.totalPrice.amount) || 0,
        order_id: result.orderName,
        content_type: 'product',
        contents: result.items.map((i) => ({ id: i.title, quantity: i.quantity })),
      },
    });
  }

  return result;
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

// ── Home-demo booking (Mumbai) ─────────────────────────────────────────────────
// Records a "book a home demo" request as a tagged DRAFT order (never completed, so
// no inventory/revenue impact): the selected bags as line items + date/slot/contact in
// the note + a `home-demo` tag, so the team sees it in Shopify → Orders → Drafts.
export async function createDemoBooking(args: {
  bags: Array<{ variantId: string; title: string }>;
  date: string;
  slot: string;
  name: string;
  email: string;
  phone: string;
  address: string;
  area: string;
  zip: string;
  /** Somewhere in the Mumbai area (Thane, Navi Mumbai, …); defaults to Mumbai. */
  city?: string;
}): Promise<DraftOrderResult | null> {
  const city = args.city?.trim() || 'Mumbai';
  const parts = args.name.trim().split(/\s+/);
  const firstName = parts.shift() || args.name.trim() || 'Guest';
  const lastName = parts.join(' ') || firstName;
  const bagTitles = args.bags.map((b) => b.title).join(', ');
  const address1 = [args.address, args.area].filter(Boolean).join(', ');
  const note =
    `HOME DEMO — ${args.date}, ${args.slot} · ${city}\n` +
    `Bags: ${bagTitles}\n` +
    `Contact: ${args.name} · ${args.phone} · ${args.email}`;

  const input: Record<string, unknown> = {
    email: args.email,
    phone: args.phone,
    tags: ['home-demo'],
    note,
    customAttributes: [
      { key: 'demo_date', value: args.date },
      { key: 'demo_slot', value: args.slot },
      { key: 'demo_bags', value: bagTitles },
    ],
    lineItems: args.bags.map((b) => ({ variantId: b.variantId, quantity: 1 })),
    shippingAddress: {
      firstName,
      lastName,
      address1,
      address2: '',
      city,
      province: 'Maharashtra',
      zip: args.zip,
      phone: args.phone,
      countryCode: 'IN',
    },
  };

  const data = await runAdminQuery<{
    draftOrderCreate: { draftOrder: RawDraftOrder | null; userErrors: Array<{ message: string }> };
  }>(DRAFT_ORDER_CREATE, { input });

  const errs = data?.draftOrderCreate?.userErrors;
  if (errs && errs.length) {
    console.error('[admin] createDemoBooking userErrors:', JSON.stringify(errs));
    return null;
  }
  return shape(data?.draftOrderCreate?.draftOrder);
}

// ── Private Viewing booking (global, video call) ────────────────────────────────
// Same tagged-draft-order pattern as the home-demo booking above, so the two
// services get the same admin visibility. Nothing ships, so there's no
// shippingAddress to fabricate — city/country are recorded in customAttributes
// and the note only. `hostRoomUrl` is the advisor's join link (Whereby only
// returns it when asked, via `fields:['hostRoomUrl']` in lib/whereby.ts) — it is
// stored here and only here, never sent to the browser; the admin dashboard's
// "Join as host" action is the one place it's read back.
export async function createPrivateViewingBooking(args: {
  bags: Array<{ variantId: string; title: string }>;
  date: string;
  slot: string;
  name: string;
  email: string;
  phone: string;
  city: string;
  country: string;
  roomId: string;
  hostRoomUrl: string;
}): Promise<DraftOrderResult | null> {
  const bagTitles = args.bags.map((b) => b.title).join(', ');
  const note =
    `PRIVATE VIEWING — ${args.date}, ${args.slot}\n` +
    `Bags: ${bagTitles}\n` +
    `Contact: ${args.name} · ${args.phone} · ${args.email}\n` +
    `Location: ${[args.city, args.country].filter(Boolean).join(', ')}`;

  const input: Record<string, unknown> = {
    email: args.email,
    phone: args.phone,
    tags: ['private-viewing'],
    note,
    customAttributes: [
      { key: 'viewing_date', value: args.date },
      { key: 'viewing_slot', value: args.slot },
      { key: 'viewing_bags', value: bagTitles },
      { key: 'viewing_city', value: args.city },
      { key: 'viewing_country', value: args.country },
      { key: 'viewing_room_id', value: args.roomId },
      { key: 'viewing_host_url', value: args.hostRoomUrl },
    ],
    lineItems: args.bags.map((b) => ({ variantId: b.variantId, quantity: 1 })),
  };

  const data = await runAdminQuery<{
    draftOrderCreate: { draftOrder: RawDraftOrder | null; userErrors: Array<{ message: string }> };
  }>(DRAFT_ORDER_CREATE, { input });

  const errs = data?.draftOrderCreate?.userErrors;
  if (errs && errs.length) {
    console.error('[admin] createPrivateViewingBooking userErrors:', JSON.stringify(errs));
    return null;
  }
  return shape(data?.draftOrderCreate?.draftOrder);
}

// ─── Newsletter ───────────────────────────────────────────────────────────────
const CUSTOMER_SUBSCRIBE = `
  mutation CustomerSubscribe($input: CustomerInput!) {
    customerCreate(input: $input) {
      customer { id }
      userErrors { field message }
    }
  }
`;

// Saves a newsletter signup as a Shopify customer with email-marketing consent, so
// subscribers land in Shopify → Customers (filter: Email subscription) ready for
// campaigns. Needs the `write_customers` scope on the India Admin app. This is
// best-effort: the /api/newsletter route also writes every signup to Firestore
// (see ~/lib/newsletter), which is the source of truth for the founders' list and
// the /admin Newsletter tab, so a signup survives even when this call fails.
export async function subscribeEmail(email: string): Promise<{ ok: boolean; error?: string }> {
  const data = await runAdminQuery<{
    customerCreate: { customer: { id: string } | null; userErrors: Array<{ field: string[]; message: string }> };
  }>(CUSTOMER_SUBSCRIBE, {
    input: {
      email,
      emailMarketingConsent: { marketingState: 'SUBSCRIBED', marketingOptInLevel: 'SINGLE_OPT_IN' },
    },
  });
  if (data?.customerCreate?.customer) return { ok: true };
  const errs = data?.customerCreate?.userErrors ?? [];
  // Already a customer → treat as already-on-the-list (a friendly success).
  if (errs.some((e) => /taken|already/i.test(e.message))) return { ok: true };
  if (!data) return { ok: false, error: 'Newsletter is not configured yet.' };
  return { ok: false, error: errs[0]?.message || 'Could not subscribe right now.' };
}

// ── Founders' dashboard: home-demo bookings + abandoned checkouts ────────────────
export type DemoStatus = 'requested' | 'confirmed' | 'completed';
export interface DemoBooking {
  id: string;
  name: string;
  createdAt: string;
  customer: string | null;
  email: string | null;
  phone: string | null;
  date: string;
  slot: string;
  bags: string;
  address: string | null;
  status: DemoStatus;
  confirmedDate: string; // ISO yyyy-mm-dd once confirmed
  confirmedTime: string; // HH:MM (24h) once confirmed
  adminUrl: string | null;
}

const DEMO_BOOKINGS = /* GraphQL */ `
  query DemoBookings($after: String) {
    draftOrders(first: 100, after: $after, query: "tag:home-demo", sortKey: UPDATED_AT, reverse: true) {
      edges { node {
        id name createdAt email phone tags
        customAttributes { key value }
        shippingAddress { name address1 address2 city province zip }
      } }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

function demoStatus(tags: string[], attrStatus: string): DemoStatus {
  if (attrStatus === 'completed' || tags.includes('demo-completed')) return 'completed';
  if (attrStatus === 'confirmed' || tags.includes('demo-confirmed')) return 'confirmed';
  return 'requested';
}

type DemoBookingNode = {
  id: string; name: string; createdAt: string; email: string | null; phone: string | null; tags: string[];
  customAttributes: Array<{ key: string; value: string }>;
  shippingAddress: { name: string | null; address1: string | null; address2: string | null; city: string | null; province: string | null; zip: string | null } | null;
};

export async function getDemoBookings(): Promise<DemoBooking[]> {
  // Paginate to the end — a fixed `first: N` silently drops older bookings once the
  // store has more than N home-demo drafts, which is exactly what was happening here.
  const nodes: DemoBookingNode[] = [];
  let after: string | null = null;
  for (let page = 0; page < 20; page++) { // 20 × 100 = 2000 drafts, generous ceiling
    const data: { draftOrders: { edges: Array<{ node: DemoBookingNode }>; pageInfo: { hasNextPage: boolean; endCursor: string | null } } } | null =
      await runAdminQuery(DEMO_BOOKINGS, { after });
    const edges = data?.draftOrders?.edges ?? [];
    nodes.push(...edges.map((e) => e.node));
    if (!data?.draftOrders?.pageInfo?.hasNextPage) break;
    after = data.draftOrders.pageInfo.endCursor;
  }
  const domain = adminDomain();
  return nodes.map((node) => {
    const attr = (k: string) => node.customAttributes.find((a) => a.key === k)?.value ?? '';
    const a = node.shippingAddress;
    const address = a ? [a.address1, a.address2, a.city, a.province, a.zip].filter(Boolean).join(', ') : null;
    return {
      id: node.id,
      name: node.name,
      createdAt: node.createdAt,
      customer: a?.name ?? null,
      email: node.email,
      phone: node.phone,
      date: attr('demo_date'),
      slot: attr('demo_slot'),
      bags: attr('demo_bags'),
      address,
      status: demoStatus(node.tags ?? [], attr('demo_status')),
      confirmedDate: attr('demo_confirmed_date'),
      confirmedTime: attr('demo_confirmed_time'),
      adminUrl: domain ? `https://${domain}/admin/draft_orders/${node.id.split('/').pop() ?? ''}` : null,
    };
  });
}

// ── Private Viewing bookings (founders' dashboard) ──────────────────────────────
// Same shape as the home-demo read above — a parallel, independent query/mapper
// rather than a shared abstraction, since the two tables' columns already diverge
// (viewing has no shipping address, but does have a city/country and a host room
// link that demo bookings have no equivalent of).
export type ViewingStatus = 'requested' | 'confirmed' | 'completed';
export interface ViewingBooking {
  id: string;
  name: string;
  createdAt: string;
  email: string | null;
  phone: string | null;
  date: string;
  slot: string;
  bags: string;
  city: string | null;
  country: string | null;
  status: ViewingStatus;
  confirmedDate: string;
  confirmedTime: string;
  roomId: string;
  hostRoomUrl: string | null; // advisor-only join link — never expose to the public viewing page
  adminUrl: string | null;
}

const VIEWING_BOOKINGS = /* GraphQL */ `
  query ViewingBookings($after: String) {
    draftOrders(first: 100, after: $after, query: "tag:private-viewing", sortKey: UPDATED_AT, reverse: true) {
      edges { node {
        id name createdAt email phone tags
        customAttributes { key value }
      } }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

function viewingStatus(tags: string[], attrStatus: string): ViewingStatus {
  if (attrStatus === 'completed' || tags.includes('viewing-completed')) return 'completed';
  if (attrStatus === 'confirmed' || tags.includes('viewing-confirmed')) return 'confirmed';
  return 'requested';
}

type ViewingBookingNode = {
  id: string; name: string; createdAt: string; email: string | null; phone: string | null; tags: string[];
  customAttributes: Array<{ key: string; value: string }>;
};

export async function getPrivateViewingBookings(): Promise<ViewingBooking[]> {
  const nodes: ViewingBookingNode[] = [];
  let after: string | null = null;
  for (let page = 0; page < 20; page++) { // 20 × 100 = 2000 drafts, generous ceiling
    const data: { draftOrders: { edges: Array<{ node: ViewingBookingNode }>; pageInfo: { hasNextPage: boolean; endCursor: string | null } } } | null =
      await runAdminQuery(VIEWING_BOOKINGS, { after });
    const edges = data?.draftOrders?.edges ?? [];
    nodes.push(...edges.map((e) => e.node));
    if (!data?.draftOrders?.pageInfo?.hasNextPage) break;
    after = data.draftOrders.pageInfo.endCursor;
  }
  const domain = adminDomain();
  return nodes.map((node) => {
    const attr = (k: string) => node.customAttributes.find((a) => a.key === k)?.value ?? '';
    return {
      id: node.id,
      name: node.name,
      createdAt: node.createdAt,
      email: node.email,
      phone: node.phone,
      date: attr('viewing_date'),
      slot: attr('viewing_slot'),
      bags: attr('viewing_bags'),
      city: attr('viewing_city') || null,
      country: attr('viewing_country') || null,
      status: viewingStatus(node.tags ?? [], attr('viewing_status')),
      confirmedDate: attr('viewing_confirmed_date'),
      confirmedTime: attr('viewing_confirmed_time'),
      roomId: attr('viewing_room_id'),
      hostRoomUrl: attr('viewing_host_url') || null,
      adminUrl: domain ? `https://${domain}/admin/draft_orders/${node.id.split('/').pop() ?? ''}` : null,
    };
  });
}

// ── Booking status changes (founders' dashboard — Try at Home + Private Viewing) ──
const DRAFT_ATTRS_GET = /* GraphQL */ `query DraftAttrs($id: ID!) { draftOrder(id: $id) { customAttributes { key value } } }`;
const DRAFT_ORDER_UPDATE = /* GraphQL */ `
  mutation DraftOrderUpdate($id: ID!, $input: DraftOrderInput!) {
    draftOrderUpdate(id: $id, input: $input) { userErrors { message } }
  }
`;

// Merges the given custom-attribute patch into the draft (draftOrderUpdate REPLACES the
// whole customAttributes array, so we read-merge-write) and additively applies tags.
// Generic over which booking type's draft order it's patching — despite the name
// surviving from when this only handled home-demo bookings, there's nothing
// demo-specific left in the body.
async function patchBookingDraft(id: string, patch: Record<string, string>, addTags: string[]): Promise<boolean> {
  const cur = await runAdminQuery<{ draftOrder: { customAttributes: Array<{ key: string; value: string }> } | null }>(DRAFT_ATTRS_GET, { id });
  if (!cur?.draftOrder) return false;
  const map = new Map<string, string>();
  cur.draftOrder.customAttributes.forEach((a) => map.set(a.key, a.value));
  Object.entries(patch).forEach(([k, v]) => map.set(k, v));
  const customAttributes = Array.from(map, ([key, value]) => ({ key, value }));
  const upd = await runAdminQuery<{ draftOrderUpdate: { userErrors: Array<{ message: string }> } }>(
    DRAFT_ORDER_UPDATE,
    { id, input: { customAttributes } },
  );
  if (!upd) return false;
  const errs = upd.draftOrderUpdate?.userErrors;
  if (errs && errs.length) { console.error('[admin] draftOrderUpdate userErrors:', JSON.stringify(errs)); return false; }
  if (addTags.length) await runAdminQuery(TAGS_ADD, { id, tags: addTags });
  return true;
}

export function confirmDemo(id: string, date: string, time: string): Promise<boolean> {
  return patchBookingDraft(id, { demo_status: 'confirmed', demo_confirmed_date: date, demo_confirmed_time: time }, ['demo-confirmed']);
}
export function completeDemo(id: string): Promise<boolean> {
  return patchBookingDraft(id, { demo_status: 'completed' }, ['demo-completed']);
}
export function confirmViewing(id: string, date: string, time: string): Promise<boolean> {
  return patchBookingDraft(id, { viewing_status: 'confirmed', viewing_confirmed_date: date, viewing_confirmed_time: time }, ['viewing-confirmed']);
}
export function completeViewing(id: string): Promise<boolean> {
  return patchBookingDraft(id, { viewing_status: 'completed' }, ['viewing-completed']);
}

export interface AbandonedLine {
  title: string;
  variant: string | null;
  quantity: number;
  price: Money | null;
}
export interface AbandonedAddress {
  name: string | null;
  address1: string | null;
  address2: string | null;
  city: string | null;
  province: string | null;
  zip: string | null;
  country: string | null;
  phone: string | null;
}
// Full breakdown shown when a founder opens an abandoned checkout (Shopify-style).
export interface AbandonedDetail {
  address: AbandonedAddress | null;
  lines: AbandonedLine[];
  subtotal: Money | null;
  shipping: Money | null;
  total: Money | null;
  adminUrl: string | null; // opens the draft in Shopify admin
  tags: string[];
}
export interface AbandonedCheckout {
  id: string;
  name: string;
  createdAt: string;
  customer: string | null;
  email: string | null;
  phone: string | null;
  total: Money | null;
  items: string;
  recoveryUrl: string | null;
  detail?: AbandonedDetail;
}

const ABANDONED_CHECKOUTS = /* GraphQL */ `
  query Abandoned {
    abandonedCheckouts(first: 50, sortKey: CREATED_AT, reverse: true) {
      edges { node {
        id
        abandonedCheckoutUrl
        createdAt
        totalPriceSet { shopMoney { amount currencyCode } }
        customer { firstName lastName email phone }
        lineItems(first: 10) { edges { node { title quantity } } }
      } }
    }
  }
`;

// Shopify-hosted abandoned checkouts (Global flow). Returns [] if the scope is
// missing or the query errors — the India Firestore leads are the primary signal.
export async function getAbandonedCheckouts(): Promise<AbandonedCheckout[]> {
  const data = await runAdminQuery<{
    abandonedCheckouts: { edges: Array<{ node: {
      id: string; abandonedCheckoutUrl: string | null; createdAt: string;
      totalPriceSet: { shopMoney: Money } | null;
      customer: { firstName: string | null; lastName: string | null; email: string | null; phone: string | null } | null;
      lineItems: { edges: Array<{ node: { title: string; quantity: number } }> };
    } }> };
  }>(ABANDONED_CHECKOUTS);
  return (data?.abandonedCheckouts?.edges ?? []).map(({ node }) => {
    const c = node.customer;
    const name = c ? [c.firstName, c.lastName].filter(Boolean).join(' ') || null : null;
    const items = node.lineItems.edges.map((e) => `${e.node.quantity}× ${e.node.title}`).join(', ');
    return {
      id: node.id,
      name: '#' + (node.id.split('/').pop() ?? ''),
      createdAt: node.createdAt,
      customer: name,
      email: c?.email ?? null,
      phone: c?.phone ?? null,
      total: node.totalPriceSet?.shopMoney ?? null,
      items,
      recoveryUrl: node.abandonedCheckoutUrl,
    };
  });
}

// ── India abandoned checkouts (reconstructed from open payment drafts) ──────────
// The India store uses a custom Cashfree checkout, so Shopify's native
// abandonedCheckouts connection is always empty for it. But every "Pay" click first
// creates a draft order (tag `web-otp`) BEFORE redirecting to Cashfree; if payment is
// never completed, that draft stays open. The reconciler completes any that were
// actually paid, so an open `web-otp` draft older than a few minutes = abandoned at
// payment. (home-demo drafts don't carry `web-otp`, so they're naturally excluded.)
const ABANDON_MIN_AGE_MS = 20 * 60 * 1000; // ignore <20-min-old drafts — buyer may still be paying

const ABANDONED_DRAFTS = /* GraphQL */ `
  query AbandonedDrafts {
    draftOrders(first: 50, query: "status:open AND tag:web-otp", sortKey: UPDATED_AT, reverse: true) {
      edges { node {
        id name createdAt email tags
        subtotalPriceSet { shopMoney { amount currencyCode } }
        totalShippingPriceSet { shopMoney { amount currencyCode } }
        totalPriceSet { shopMoney { amount currencyCode } }
        shippingAddress { name firstName lastName address1 address2 city province zip country phone }
        lineItems(first: 25) { edges { node {
          title quantity variantTitle
          originalUnitPriceSet { shopMoney { amount currencyCode } }
        } } }
      } }
    }
  }
`;

interface RawAbandonedDraft {
  id: string; name: string; createdAt: string; email: string | null; tags: string[];
  subtotalPriceSet: { shopMoney: Money } | null;
  totalShippingPriceSet: { shopMoney: Money } | null;
  totalPriceSet: { shopMoney: Money } | null;
  shippingAddress: {
    name: string | null; firstName: string | null; lastName: string | null;
    address1: string | null; address2: string | null; city: string | null;
    province: string | null; zip: string | null; country: string | null; phone: string | null;
  } | null;
  lineItems: { edges: Array<{ node: {
    title: string; quantity: number; variantTitle: string | null;
    originalUnitPriceSet: { shopMoney: Money } | null;
  } }> };
}

export async function getAbandonedDrafts(): Promise<AbandonedCheckout[]> {
  const data = await runAdminQuery<{ draftOrders: { edges: Array<{ node: RawAbandonedDraft }> } }>(ABANDONED_DRAFTS);
  const now = Date.now();
  const domain = adminDomain();
  return (data?.draftOrders?.edges ?? [])
    .filter(({ node }) => now - new Date(node.createdAt).getTime() >= ABANDON_MIN_AGE_MS)
    .map(({ node }) => {
      const a = node.shippingAddress;
      const name = a ? (a.name || [a.firstName, a.lastName].filter(Boolean).join(' ')) || null : null;
      const lines: AbandonedLine[] = node.lineItems.edges.map((e) => ({
        title: e.node.title,
        variant: e.node.variantTitle && e.node.variantTitle !== 'Default Title' ? e.node.variantTitle : null,
        quantity: e.node.quantity,
        price: e.node.originalUnitPriceSet?.shopMoney ?? null,
      }));
      const items = lines.map((l) => `${l.quantity}× ${l.title}`).join(', ');
      const numericId = node.id.split('/').pop() ?? '';
      return {
        id: node.id,
        name: node.name,
        createdAt: node.createdAt,
        customer: name,
        email: node.email ?? null,
        phone: a?.phone ?? null,
        total: node.totalPriceSet?.shopMoney ?? null,
        items,
        recoveryUrl: null, // no self-serve recovery link — reach out via phone/email
        detail: {
          address: a
            ? {
                name, address1: a.address1, address2: a.address2, city: a.city,
                province: a.province, zip: a.zip, country: a.country, phone: a.phone,
              }
            : null,
          lines,
          subtotal: node.subtotalPriceSet?.shopMoney ?? null,
          shipping: node.totalShippingPriceSet?.shopMoney ?? null,
          total: node.totalPriceSet?.shopMoney ?? null,
          adminUrl: domain ? `https://${domain}/admin/draft_orders/${numericId}` : null,
          tags: node.tags ?? [],
        },
      };
    });
}

// ── Founders' dashboard: recent orders (all, not by email) ──────────────────────
export interface RecentOrder {
  id: string;
  name: string;
  createdAt: string;
  customer: string | null;
  email: string | null;
  phone: string | null;
  total: Money | null;
  items: string;
  fulfillment: string;   // order-level: UNFULFILLED / FULFILLED / …
  financial: string;     // PAID / PENDING / AUTHORIZED / …
  deliveryStatus: string; // latest fulfillment: IN_TRANSIT / OUT_FOR_DELIVERY / DELIVERED / …
  fulfilledAt: string | null;  // when it was fulfilled / shipped
  deliveredAt: string | null;  // when it was delivered (needs tracking)
  inTransitAt: string | null;
  etaAt: string | null;        // estimated delivery
  cancelled: boolean;
  adminUrl: string | null;
  clickId: string | null; // affiliate click this order came from, if any
  paymentMethod: 'cod' | 'cashfree' | null; // from the 'cod'/'cashfree' tag stamped at completion
  waOptin: boolean;       // customer ticked "order updates on WhatsApp" at checkout
}

const RECENT_ORDERS = /* GraphQL */ `
  query RecentOrders {
    orders(first: 40, sortKey: CREATED_AT, reverse: true) {
      edges { node {
        id name createdAt email cancelledAt tags
        displayFinancialStatus displayFulfillmentStatus
        totalPriceSet { shopMoney { amount currencyCode } }
        shippingAddress { name phone }
        customAttributes { key value }
        fulfillments(first: 1) { displayStatus createdAt inTransitAt deliveredAt estimatedDeliveryAt }
        lineItems(first: 5) { edges { node { title quantity } } }
      } }
    }
  }
`;

export async function getRecentOrders(): Promise<RecentOrder[]> {
  const data = await runAdminQuery<{
    orders: { edges: Array<{ node: {
      id: string; name: string; createdAt: string; email: string | null; cancelledAt: string | null; tags: string[];
      displayFinancialStatus: string | null; displayFulfillmentStatus: string | null;
      totalPriceSet: { shopMoney: Money } | null;
      shippingAddress: { name: string | null; phone: string | null } | null;
      customAttributes: Array<{ key: string; value: string }>;
      fulfillments: Array<{ displayStatus: string | null; createdAt: string | null; inTransitAt: string | null; deliveredAt: string | null; estimatedDeliveryAt: string | null }>;
      lineItems: { edges: Array<{ node: { title: string; quantity: number } }> };
    } }> };
  }>(RECENT_ORDERS);
  const domain = adminDomain();
  return (data?.orders?.edges ?? []).map(({ node }) => {
    const f = node.fulfillments?.[0];
    const tags = node.tags ?? [];
    return {
      id: node.id,
      name: node.name,
      createdAt: node.createdAt,
      customer: node.shippingAddress?.name ?? null,
      email: node.email,
      phone: node.shippingAddress?.phone ?? null,
      total: node.totalPriceSet?.shopMoney ?? null,
      items: node.lineItems.edges.map((e) => `${e.node.quantity}× ${e.node.title}`).join(', '),
      fulfillment: node.displayFulfillmentStatus ?? '',
      financial: node.displayFinancialStatus ?? '',
      deliveryStatus: f?.displayStatus ?? '',
      fulfilledAt: f?.createdAt ?? null,
      deliveredAt: f?.deliveredAt ?? null,
      inTransitAt: f?.inTransitAt ?? null,
      etaAt: f?.estimatedDeliveryAt ?? null,
      cancelled: !!node.cancelledAt,
      adminUrl: domain ? `https://${domain}/admin/orders/${node.id.split('/').pop() ?? ''}` : null,
      clickId: node.customAttributes?.find((a) => a.key === 'click_id')?.value ?? null,
      paymentMethod: tags.includes('cod') ? 'cod' : tags.includes('cashfree') ? 'cashfree' : null,
      waOptin: node.customAttributes?.find((a) => a.key === 'wa_optin')?.value === 'true',
    };
  });
}
