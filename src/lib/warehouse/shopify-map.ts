// Shopify → Neon row mapping for the orders, returns and bookings mirrors. Pure — no
// database, no network, no `~/` imports — so `node src/lib/warehouse/orders.test.mjs`
// can import it directly. The fetching/upserting lives in ./orders.ts and ./bookings.ts.
import { personIdFor, personKey } from '../events.ts';

export type Store = 'india' | 'global';

type MoneyV2 = { amount: string; currencyCode: string };
type Address = { name: string | null; city: string | null; countryCodeV2: string | null; phone: string | null } | null;

// The fields ORDER_FIELDS (orders.ts) asks for. Keep the two in step.
export interface OrderNode {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  cancelledAt: string | null;
  test: boolean;
  tags: string[];
  note: string | null;
  email: string | null;
  phone: string | null;
  customAttributes?: Array<{ key: string; value: string }>;   // `click_id` ties the order to an affiliate click
  paymentGatewayNames: string[];
  discountCodes: string[];
  displayFinancialStatus: string | null;
  displayFulfillmentStatus: string | null;
  totalPriceSet: { shopMoney: MoneyV2; presentmentMoney: MoneyV2 };
  customer: { displayName: string | null; phone: string | null; email: string | null } | null;
  billingAddress: Address;
  shippingAddress: Address;
  lineItems: { edges: Array<{ node: LineNode }>; pageInfo?: { hasNextPage: boolean } };
  returns: { edges: Array<{ node: ReturnNode }> };
}

interface LineNode {
  title: string;
  variantTitle: string | null;
  quantity: number;
  originalUnitPriceSet: { presentmentMoney: MoneyV2 } | null;
  product: { handle: string } | null;
}

interface ReturnNode {
  id: string;
  name: string;
  status: string;
  createdAt: string;
  returnLineItems: { edges: Array<{ node: {
    quantity: number;
    returnReason: string | null;
    returnReasonNote: string | null;
    customerNote: string | null;
    fulfillmentLineItem?: { lineItem: LineNode | null } | null;
  } }> };
}

export interface OrderItem { handle: string | null; title: string; variant: string | null; quantity: number; price: number | null }

export interface OrderRow {
  order_id: string;
  store: Store;
  name: string;
  created_at: string;
  cancelled_at: string | null;
  person_id: string | null;
  phone: string | null;
  email: string | null;
  currency: string;
  total: number;
  total_inr: number | null;
  shop_currency: string;
  shop_total: number;
  discount_codes: string[];
  payment_method: string | null;
  billing_name: string | null;
  shipping_name: string | null;
  shipping_city: string | null;
  shipping_country: string | null;
  likely_gift: boolean | null;
  items: OrderItem[];
  financial_status: string | null;
  fulfillment_status: string | null;
  is_test: boolean;
  click_id: string | null;
  updated_at: string;
}

export interface ReturnRow {
  return_id: string;
  order_id: string;
  person_id: string | null;
  created_at: string;
  reason: string | null;
  items: OrderItem[];
  source: 'portal' | 'shopify';
  status: string | null;
}

const num = (s: string | null | undefined): number | null => {
  const n = Number(s);
  return s != null && s !== '' && Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
};
const clean = (s: string | null | undefined): string | null => (s && s.trim() ? s.trim() : null);

// ── Gift inference ──────────────────────────────────────────────────────────

const tokens = (s: string | null | undefined): string[] =>
  String(s ?? '').toLowerCase().normalize('NFKD').replace(/[^a-z\s]/g, ' ').split(/\s+/).filter((t) => t.length > 1);

// Same person if every word of the shorter name is in the longer one, so "Priya",
// "priya  sharma" and "Priya Sharma" all match, but "Priya Sharma" vs "Neha Sharma"
// doesn't. Unknown (either side blank) → null.
export function sameName(a: string | null | undefined, b: string | null | undefined): boolean | null {
  const x = [...new Set(tokens(a))], y = [...new Set(tokens(b))];
  if (!x.length || !y.length) return null;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  return short.every((t) => long.includes(t));
}

// Same word-subset rule, so "Wandsworth, London" and "London" count as one city.
const sameCity = sameName;

// Likely a gift: shipped to someone other than the buyer (shipping name differs from
// the billing name, or from the customer's name when there's no billing address — the
// India checkout never sets one), or to a different city than the billing address.
// null = can't tell (no shipping address, or nothing to compare it with).
export function likelyGift(o: Pick<OrderNode, 'billingAddress' | 'shippingAddress' | 'customer'>): boolean | null {
  const ship = o.shippingAddress;
  if (!ship) return null;
  const buyerName = clean(o.billingAddress?.name) ?? clean(o.customer?.displayName);
  const names = sameName(ship.name, buyerName);
  const cities = sameCity(ship.city, o.billingAddress?.city);
  if (names === false || cities === false) return true;
  if (names === null && cities === null) return null;
  return false;
}

// The BUYER's phone. Shipping phone only as a last resort and never on a gift, where
// it's the recipient's.
export function buyerPhone(o: Pick<OrderNode, 'phone' | 'customer' | 'billingAddress' | 'shippingAddress'>, gift: boolean | null): string | null {
  for (const p of [o.phone, o.customer?.phone, o.billingAddress?.phone]) if (personKey(p)) return p as string;
  if (gift !== true && personKey(o.shippingAddress?.phone)) return o.shippingAddress!.phone;
  return null;
}

// The India checkout completes draft orders with the 'manual' gateway and stamps the
// real method as a 'cod' / 'cashfree' tag; Global uses Shopify's own gateways.
export function paymentMethod(o: Pick<OrderNode, 'tags' | 'paymentGatewayNames'>): string | null {
  const tags = o.tags ?? [];
  if (tags.includes('cod')) return 'cod';
  if (tags.includes('cashfree')) return 'cashfree';
  const g = (o.paymentGatewayNames ?? []).map((s) => s.trim().toLowerCase()).filter(Boolean);
  return g.length ? [...new Set(g)].join('+') : null;
}

const item = (n: LineNode, quantity = n.quantity): OrderItem => ({
  handle: n.product?.handle ?? null,
  title: n.title,
  variant: clean(n.variantTitle),
  quantity,
  price: num(n.originalUnitPriceSet?.presentmentMoney?.amount),
});

// ── Orders ──────────────────────────────────────────────────────────────────

// INR value of an order. `fx(currency, day)` = rupees per unit of `currency` on that
// day, or null when unknown. The India store sells in INR, so that's exact. Global's
// shop currency is USD: its USD total (Shopify's own conversion from what the
// customer paid, at order time) × that day's USD→INR reference rate. That rate is
// ECB's (see fxRates in orders.ts), not what the bank actually settled at, so global
// INR figures are close but not to the rupee.
export function totalInr(
  o: Pick<OrderNode, 'totalPriceSet' | 'createdAt'>,
  fx: (currency: string, day: string) => number | null,
): number | null {
  const pm = o.totalPriceSet.presentmentMoney, sm = o.totalPriceSet.shopMoney;
  if (pm.currencyCode === 'INR') return num(pm.amount);
  if (sm.currencyCode === 'INR') return num(sm.amount);
  const rate = fx(sm.currencyCode, o.createdAt.slice(0, 10));
  const amt = num(sm.amount);
  return rate && amt != null ? Math.round(amt * rate * 100) / 100 : null;
}

export function orderRow(store: Store, o: OrderNode, fx: (currency: string, day: string) => number | null): OrderRow {
  const gift = likelyGift(o);
  const phone = buyerPhone(o, gift);
  const email = clean(o.email) ?? clean(o.customer?.email);
  const pm = o.totalPriceSet.presentmentMoney, sm = o.totalPriceSet.shopMoney;
  return {
    order_id: o.id,
    store,
    name: o.name,
    created_at: o.createdAt,
    cancelled_at: o.cancelledAt,
    person_id: personIdFor(phone, email) || null,
    phone,
    email: email?.toLowerCase() ?? null,
    // What the customer paid, in the currency they paid in.
    currency: pm.currencyCode,
    total: num(pm.amount) ?? 0,
    total_inr: totalInr(o, fx),
    shop_currency: sm.currencyCode,
    shop_total: num(sm.amount) ?? 0,
    // Codes are case-insensitive in Shopify; upper-case so "Hi" and "HI" group together.
    discount_codes: [...new Set((o.discountCodes ?? []).map((c) => c.trim().toUpperCase()).filter(Boolean))],
    payment_method: paymentMethod(o),
    billing_name: clean(o.billingAddress?.name) ?? clean(o.customer?.displayName),
    shipping_name: clean(o.shippingAddress?.name),
    shipping_city: clean(o.shippingAddress?.city),
    shipping_country: clean(o.shippingAddress?.countryCodeV2),
    likely_gift: gift,
    items: o.lineItems.edges.map((e) => item(e.node)),
    financial_status: o.displayFinancialStatus,
    fulfillment_status: o.displayFulfillmentStatus,
    is_test: !!o.test,
    click_id: clean(o.customAttributes?.find((a) => a.key === 'click_id')?.value),
    updated_at: o.updatedAt,
  };
}

// ── Returns ─────────────────────────────────────────────────────────────────

// The returns portal / account page (requestReturn in shopify/admin.ts) tags the order
// 'return-requested' and appends "Return requested: <reason> (YYYY-MM-DD)" to its note.
// One request per order per day; /api/returns writes the same id at request time, so
// the sync and the live insert land on one row.
export const portalReturnId = (orderId: string, day: string) => `req:${orderId.split('/').pop()}:${day}`;
const NOTE_LINE = /^Return requested(?::\s*(.*?))?\s*\((\d{4}-\d{2}-\d{2})\)\s*$/;

export function orderReturns(o: OrderNode, row: Pick<OrderRow, 'order_id' | 'person_id' | 'items'>): ReturnRow[] {
  const out: ReturnRow[] = [];
  for (const line of String(o.note ?? '').split('\n')) {
    const m = line.trim().match(NOTE_LINE);
    if (!m) continue;
    out.push({
      return_id: portalReturnId(o.id, m[2]),
      order_id: row.order_id,
      person_id: row.person_id,
      created_at: `${m[2]}T00:00:00Z`,
      reason: clean(m[1]),
      items: row.items, // the portal returns a whole order
      source: 'portal',
      status: 'requested',
    });
  }
  // Returns opened in Shopify itself (admin or customer accounts).
  for (const { node: r } of o.returns?.edges ?? []) {
    const lines = r.returnLineItems.edges.map((e) => e.node);
    const reasons = lines
      .map((l) => [l.returnReason && l.returnReason !== 'UNKNOWN' ? l.returnReason.toLowerCase().replace(/_/g, ' ') : null,
        clean(l.returnReasonNote), clean(l.customerNote)].filter(Boolean).join(': '))
      .filter(Boolean);
    out.push({
      return_id: r.id,
      order_id: row.order_id,
      person_id: row.person_id,
      created_at: r.createdAt,
      reason: [...new Set(reasons)].join('; ') || null,
      items: lines.flatMap((l) => (l.fulfillmentLineItem?.lineItem ? [item(l.fulfillmentLineItem.lineItem, l.quantity)] : [])),
      source: 'shopify',
      status: r.status,
    });
  }
  return out;
}

// ── Bookings (Try at Home / Private Viewing draft orders) ───────────────────

export interface DraftNode {
  id: string;
  createdAt: string;
  status: string;
  tags: string[];
  email: string | null;
  phone: string | null;
  customAttributes: Array<{ key: string; value: string }>;
  shippingAddress: { city: string | null } | null;
  lineItems: { edges: Array<{ node: { title: string; product: { handle: string } | null } }> };
}

export interface BookingRow {
  booking_id: string;
  flow: 'try_at_home' | 'private_viewing';
  person_id: string | null;
  created_at: string;
  date: string | null;
  slot: string | null;
  city: string | null;
  bags: string[];
  status: string;
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

// Booking dates are ISO (Private Viewing, and confirmed dates) or "Fri, 23 Oct" with no
// year (the Try at Home form). The year is the first one that puts the day on or after
// the booking was made — nobody books a visit in the past.
export function bookingDate(v: string | null | undefined, createdAt: string): string | null {
  const s = String(v ?? '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.toLowerCase().match(/(\d{1,2})\s+([a-z]{3})/);
  if (!m) return null;
  const mon = MONTHS.indexOf(m[2]);
  const day = Number(m[1]);
  if (mon < 0 || day < 1 || day > 31) return null;
  const made = createdAt.slice(0, 10);
  let year = Number(made.slice(0, 4));
  const iso = (y: number) => `${y}-${String(mon + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  if (iso(year) < made) year++;
  return iso(year);
}

// Mirrors demoStatus/viewingStatus in shopify/admin.ts.
function bookingStatus(tags: string[], attrStatus: string, prefix: 'demo' | 'viewing'): string {
  if (attrStatus === 'completed' || tags.includes(`${prefix}-completed`)) return 'completed';
  if (attrStatus === 'confirmed' || tags.includes(`${prefix}-confirmed`)) return 'confirmed';
  return 'requested';
}

export function bookingRow(d: DraftNode): BookingRow | null {
  const tags = d.tags ?? [];
  const tah = tags.includes('home-demo');
  if (!tah && !tags.includes('private-viewing')) return null;
  const p = tah ? 'demo' : 'viewing';
  const attr = (k: string) => d.customAttributes.find((a) => a.key === `${p}_${k}`)?.value ?? '';
  const handles = d.lineItems.edges.map((e) => e.node.product?.handle || e.node.title).filter(Boolean);
  return {
    booking_id: d.id,
    flow: tah ? 'try_at_home' : 'private_viewing',
    person_id: personIdFor(d.phone, d.email) || null,
    created_at: d.createdAt,
    // The visit's actual day once staff confirm it, else the day asked for.
    date: bookingDate(attr('confirmed_date') || attr('date'), d.createdAt),
    slot: clean(attr('slot')),
    city: clean(tah ? d.shippingAddress?.city : attr('city')) ?? (tah ? 'Mumbai' : null),
    bags: [...new Set(handles)],
    status: bookingStatus(tags, attr('status'), p),
  };
}

// ── FX ──────────────────────────────────────────────────────────────────────

// Rate for `day` from a {YYYY-MM-DD: rate} series: that day's, else the latest before
// it (no ECB fix on weekends/holidays, or today's not out yet), else the earliest.
export function rateOn(series: Record<string, number>, day: string): number | null {
  const days = Object.keys(series).sort();
  if (!days.length) return null;
  let pick = days[0];
  for (const d of days) { if (d <= day) pick = d; else break; }
  return series[pick] ?? null;
}
