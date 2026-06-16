// Shopify helpers: webhook HMAC verification, phone normalisation, event mapping,
// and pulling the fields we need out of the order / fulfillment payload.

/** Constant-time string compare (avoid leaking timing on the HMAC check). */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

/** Verify the X-Shopify-Hmac-Sha256 header against the RAW request body. */
export async function verifyShopifyHmac(rawBody: string, hmacHeader: string, secret: string): Promise<boolean> {
  if (!hmacHeader || !secret) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
  const digest = btoa(String.fromCharCode(...new Uint8Array(sig)));
  return timingSafeEqual(digest, hmacHeader);
}

/**
 * India-first normaliser. Meta wants digits only (no '+'): a bare 10-digit number
 * gets the country code prepended; a number that already carries a country code is
 * left as-is.
 */
export function normalizePhone(raw: string | null | undefined, defaultCc = "91"): string | null {
  if (!raw) return null;
  let d = String(raw).replace(/\D/g, "");
  if (!d) return null;
  if (d.length === 10) d = defaultCc + d;
  else if (d.length === 11 && d.startsWith("0")) d = defaultCc + d.slice(1);
  return d;
}

/** Cash-on-Delivery detection from the order's payment gateway. */
export function isCOD(order: any): boolean {
  const gws = Array.isArray(order?.payment_gateway_names) ? order.payment_gateway_names.join(" ") : "";
  const gw = order?.gateway ?? "";
  return /cash on delivery|\bcod\b/i.test(`${gws} ${gw}`);
}

export type EventKey =
  | "order_confirmed"
  | "cod_confirmation"
  | "order_shipped"
  | "order_cancelled"
  | "refund_processed";

/** Map a Shopify webhook topic (+ payload) to one of our event keys. */
export function detectEventKey(topic: string, payload: any): EventKey | null {
  if (topic === "orders/create") return isCOD(payload) ? "cod_confirmation" : "order_confirmed";
  if (topic === "orders/fulfilled") return "order_shipped";
  if (topic === "orders/cancelled") return "order_cancelled";
  if (topic === "refunds/create") return "refund_processed";
  return null;
}

/** Bare order number for the "#{{n}}" templates (no leading '#'). */
export function orderNumber(p: any): string {
  if (p?.order_number != null) return String(p.order_number);
  return String(p?.name ?? "").replace(/^#/, "") || "your order";
}

/** Shopify cancel_reason → friendly text. */
export function cancelReasonText(reason: string | null | undefined): string {
  switch ((reason ?? "").toLowerCase()) {
    case "customer": return "cancelled at your request";
    case "inventory": return "an item was unavailable";
    case "declined": return "the payment was declined";
    case "fraud": return "a verification issue";
    case "staff": return "a store adjustment";
    default: return "an order issue";
  }
}

export function formatMoney(total: any, currency = "INR"): string {
  const n = Math.round(Number(total) || 0);
  const sym: Record<string, string> = { INR: "₹", USD: "$", EUR: "€", GBP: "£" };
  const s = sym[currency] ?? (currency ? currency + " " : "");
  try {
    return s + n.toLocaleString("en-IN");
  } catch {
    return s + String(n);
  }
}

export interface Recipient {
  phone: string | null;
  name: string;
  orderNum: string;
  total: string;
  trackingUrl: string;
  reason: string;
}

/** Pull the message fields from an order payload (create / fulfilled / cancelled). */
export function extractRecipient(p: any): Recipient {
  const cust = p?.customer ?? {};
  const ship = p?.shipping_address ?? {};
  const bill = p?.billing_address ?? {};
  const rawPhone = cust.phone || ship.phone || bill.phone || p?.phone || null;
  const name = (cust.first_name || ship.first_name || "there").toString().trim() || "there";
  const total = formatMoney(p?.total_price, p?.currency || "INR");

  const f = Array.isArray(p?.fulfillments) ? p.fulfillments[0] : null;
  const trackingUrl = (
    f?.tracking_url ||
    (Array.isArray(f?.tracking_urls) ? f.tracking_urls[0] : "") ||
    p?.order_status_url ||
    "https://mirkash.in"
  ).toString();

  return {
    phone: normalizePhone(rawPhone),
    name,
    orderNum: orderNumber(p),
    total,
    trackingUrl,
    reason: cancelReasonText(p?.cancel_reason),
  };
}

/**
 * Opt-in marker check (only enforced when store_config.require_optin = true).
 * Looks for an order tag `wa-optin` or a note attribute `wa_optin = true/yes/1`.
 */
export function hasOptIn(order: any): boolean {
  const tags = (order?.tags || "").toString().toLowerCase().split(",").map((t: string) => t.trim());
  if (tags.includes("wa-optin")) return true;
  const attrs = Array.isArray(order?.note_attributes) ? order.note_attributes : [];
  return attrs.some(
    (a: any) => String(a?.name).toLowerCase() === "wa_optin" && /true|yes|1/i.test(String(a?.value)),
  );
}
