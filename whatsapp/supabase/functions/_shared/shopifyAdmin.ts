// Minimal Shopify Admin lookup — used ONLY by the refund path, because the
// refunds/create webhook doesn't include the customer phone or order number.
// Auth = client-credentials grant (Client ID + Secret → short-lived token), same
// as the website's admin client. Returns null if the SHOPIFY_IN_ADMIN_* secrets
// aren't set, so the other 4 message types work without them.
import { normalizePhone } from "./shopify.ts";

const API_VERSION = "2025-01";

function env(k: string): string {
  return Deno.env.get(k) ?? "";
}

function adminDomain(): string {
  return env("SHOPIFY_IN_ADMIN_DOMAIN");
}

export function adminConfigured(): boolean {
  return Boolean(adminDomain() && env("SHOPIFY_IN_ADMIN_CLIENT_ID") && env("SHOPIFY_IN_ADMIN_CLIENT_SECRET"));
}

let cached: { token: string; expiresAt: number } | null = null;

async function getToken(): Promise<string | null> {
  const now = Date.now();
  if (cached && cached.expiresAt > now + 60_000) return cached.token;
  const domain = adminDomain();
  if (!adminConfigured()) return null;
  try {
    const res = await fetch(`https://${domain}/admin/oauth/access_token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: env("SHOPIFY_IN_ADMIN_CLIENT_ID"),
        client_secret: env("SHOPIFY_IN_ADMIN_CLIENT_SECRET"),
        grant_type: "client_credentials",
      }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.access_token) return null;
    cached = { token: json.access_token, expiresAt: now + (json.expires_in ?? 86400) * 1000 };
    return cached.token;
  } catch {
    return null;
  }
}

export interface OrderLookup {
  phone: string | null;
  orderNum: string;
  firstName: string;
}

/** Fetch the phone + order number + first name for a refund's order. */
export async function lookupOrder(orderId: string | number): Promise<OrderLookup | null> {
  const domain = adminDomain();
  const token = await getToken();
  if (!domain || !token) return null;
  const gid = `gid://shopify/Order/${orderId}`;
  const query = `query($id: ID!) {
    order(id: $id) {
      name
      phone
      customer { firstName phone }
      shippingAddress { firstName phone }
      billingAddress { phone }
    }
  }`;
  try {
    const res = await fetch(`https://${domain}/admin/api/${API_VERSION}/graphql.json`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
      body: JSON.stringify({ query, variables: { id: gid } }),
    });
    const json = await res.json().catch(() => ({}));
    const o = json?.data?.order;
    if (!o) return null;
    const rawPhone = o.phone || o.customer?.phone || o.shippingAddress?.phone || o.billingAddress?.phone || null;
    const firstName = (o.customer?.firstName || o.shippingAddress?.firstName || "there").toString().trim() || "there";
    return {
      phone: normalizePhone(rawPhone),
      orderNum: String(o.name ?? "").replace(/^#/, "") || String(orderId),
      firstName,
    };
  } catch {
    return null;
  }
}
