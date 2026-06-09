// Cashfree Payment Gateway — server-side only. Holds the secret key; never import
// from client code. Used by the India custom checkout to create a payment order,
// verify status, and reconcile webhooks. The Global store is unaffected.
import crypto from 'node:crypto';
import type { AstroCookies } from 'astro';
import { completeDraftOrder } from '~/lib/shopify/admin';
import { clearCart } from '~/lib/cart-session';
import { markLeadPaid } from '~/lib/firestore';

const API_VERSION = '2023-08-01';

function getEnv(key: string): string {
  if (typeof process !== 'undefined' && process.env && process.env[key]) {
    return process.env[key] as string;
  }
  const meta = import.meta.env as Record<string, string | undefined>;
  return meta[key] ?? '';
}

function mode(): 'sandbox' | 'production' {
  return getEnv('CASHFREE_ENV') === 'production' ? 'production' : 'sandbox';
}

function baseUrl(): string {
  return mode() === 'production' ? 'https://api.cashfree.com/pg' : 'https://sandbox.cashfree.com/pg';
}

function headers(): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'x-api-version': API_VERSION,
    'x-client-id': getEnv('CASHFREE_APP_ID'),
    'x-client-secret': getEnv('CASHFREE_SECRET_KEY'),
  };
}

export function cashfreeConfigured(): boolean {
  return Boolean(getEnv('CASHFREE_APP_ID') && getEnv('CASHFREE_SECRET_KEY'));
}

// Shopify draft-order GIDs contain "/" and ":" which are unsafe in Cashfree
// order_tags values, so we store only the numeric id and rebuild the GID.
function draftNumericId(gid: string): string {
  return gid.split('/').pop() ?? gid;
}
function draftGid(numeric: string): string {
  return `gid://shopify/DraftOrder/${numeric}`;
}

// ── Create order ───────────────────────────────────────────────────────────────
export interface CreateOrderArgs {
  orderId: string;
  amount: number; // major units (INR rupees)
  customer: { id: string; phone: string; email: string; name: string };
  returnUrl: string; // {order_id} placeholder is appended by Cashfree
  notifyUrl: string;
  draftOrderId: string; // Shopify draft order GID
}

export interface CreateOrderResult {
  paymentSessionId: string;
  cfOrderId: string;
}

export async function createCashfreeOrder(args: CreateOrderArgs): Promise<CreateOrderResult | null> {
  if (!cashfreeConfigured()) {
    console.warn('[cashfree] Missing CASHFREE_APP_ID/SECRET_KEY — returning null.');
    return null;
  }
  const body = {
    order_id: args.orderId,
    order_amount: Number(args.amount.toFixed(2)),
    order_currency: 'INR',
    customer_details: {
      customer_id: args.customer.id,
      customer_phone: args.customer.phone,
      customer_email: args.customer.email,
      customer_name: args.customer.name,
    },
    order_meta: {
      return_url: `${args.returnUrl}?order_id={order_id}`,
      notify_url: args.notifyUrl,
    },
    order_tags: { draft_order_id: draftNumericId(args.draftOrderId) },
  };

  try {
    const res = await fetch(`${baseUrl()}/orders`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify(body),
    });
    const json = (await res.json()) as {
      payment_session_id?: string;
      cf_order_id?: string;
      message?: string;
    };
    if (!res.ok || !json.payment_session_id) {
      console.error('[cashfree] createOrder failed:', res.status, json.message ?? JSON.stringify(json));
      return null;
    }
    return { paymentSessionId: json.payment_session_id, cfOrderId: String(json.cf_order_id ?? '') };
  } catch (err) {
    console.error('[cashfree] createOrder error:', err);
    return null;
  }
}

// ── Get order (status check) ───────────────────────────────────────────────────
export interface CashfreeOrder {
  orderStatus: string; // PAID | ACTIVE | EXPIRED | TERMINATED ...
  draftOrderId: string | null; // reconstructed Shopify GID from order_tags
}

export async function getCashfreeOrder(orderId: string): Promise<CashfreeOrder | null> {
  if (!cashfreeConfigured()) return null;
  try {
    const res = await fetch(`${baseUrl()}/orders/${encodeURIComponent(orderId)}`, {
      method: 'GET',
      headers: headers(),
    });
    const json = (await res.json()) as {
      order_status?: string;
      order_tags?: Record<string, string> | null;
    };
    if (!res.ok || !json.order_status) {
      console.error('[cashfree] getOrder failed:', res.status, JSON.stringify(json));
      return null;
    }
    const num = json.order_tags?.draft_order_id;
    return {
      orderStatus: json.order_status,
      draftOrderId: num ? draftGid(num) : null,
    };
  } catch (err) {
    console.error('[cashfree] getOrder error:', err);
    return null;
  }
}

// ── Webhook signature ──────────────────────────────────────────────────────────
// HMAC-SHA256 over (timestamp + raw body), base64, keyed with the secret key.
export function verifyWebhookSignature(timestamp: string, rawBody: string, signature: string): boolean {
  const secret = getEnv('CASHFREE_SECRET_KEY');
  if (!secret || !timestamp || !signature) return false;
  const expected = crypto
    .createHmac('sha256', secret)
    .update(timestamp + rawBody)
    .digest('base64');
  try {
    const a = Buffer.from(expected);
    const b = Buffer.from(signature);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

// ── Finalize ───────────────────────────────────────────────────────────────────
// Shared by the return page (with cookies → clears the cart) and the webhook
// (no cookies). Idempotent: completing an already-completed draft is a no-op.
export type FinalizeStatus = 'paid' | 'pending' | 'failed' | 'error';
export interface FinalizeResult {
  status: FinalizeStatus;
  orderName?: string;
}

export async function finalizeOrder(orderId: string, cookies?: AstroCookies): Promise<FinalizeResult> {
  const cf = await getCashfreeOrder(orderId);
  if (!cf) return { status: 'error' };

  if (cf.orderStatus === 'PAID') {
    if (!cf.draftOrderId) {
      console.error('[cashfree] PAID order missing draft_order_id tag:', orderId);
      return { status: 'error' };
    }
    const order = await completeDraftOrder(cf.draftOrderId);
    if (!order) return { status: 'error' };
    if (cookies) clearCart(cookies, 'india');
    await markLeadPaid(orderId, order.orderName ?? order.name);
    return { status: 'paid', orderName: order.orderName ?? order.name };
  }

  if (cf.orderStatus === 'ACTIVE') return { status: 'pending' };
  return { status: 'failed' };
}
