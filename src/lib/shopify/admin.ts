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

export function adminConfigured(): boolean {
  return Boolean(
    adminDomain() && getEnv('SHOPIFY_IN_ADMIN_CLIENT_ID') && getEnv('SHOPIFY_IN_ADMIN_CLIENT_SECRET'),
  );
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
}): Promise<DraftOrderResult | null> {
  const input = {
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
export async function completeDraftOrder(id: string): Promise<DraftOrderResult | null> {
  const existing = await getDraftOrder(id);
  if (existing && existing.status === 'COMPLETED') return existing;

  const data = await runAdminQuery<{
    draftOrderComplete: { draftOrder: RawDraftOrder | null; userErrors: Array<{ message: string }> };
  }>(DRAFT_ORDER_COMPLETE, { id });

  const errs = data?.draftOrderComplete?.userErrors;
  if (errs && errs.length) {
    console.error('[admin] draftOrderComplete userErrors:', JSON.stringify(errs));
    return existing; // fall back to whatever state we last read
  }
  return shape(data?.draftOrderComplete?.draftOrder);
}
