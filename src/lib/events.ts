// The event contract: every name the site may send to /api/collect, how a payload
// is cleaned, and how a visit's source is worked out. Shared by the server
// (src/pages/api/collect.ts) and the tests. Pure — no database, no `~/` imports —
// so `node src/lib/events.test.mjs` can import it directly.
//
// Adding an event: add it to EVENTS with a one-line meaning, send it from the page
// with window.mkEvent(name, {…}), and read it in SQL. Nothing else to register.

export const EVENTS = {
  // Pages + attention (sent by the tracker in BaseLayout)
  page_view: 'A page loaded',
  page_engaged: 'Engaged time + max scroll for one page view (props.ms, props.scroll)',
  // Shopping
  product_view: 'Product page opened (product = handle)',
  sold_out_view: 'Product page opened on a sold-out colour',
  gallery_view: 'Gallery image shown (props.index)',
  gallery_zoom: 'Gallery image zoomed (props.index)',
  swatch_select: 'Colour chosen (props.colour)',
  section_open: 'Product detail section opened (props.section: details|materials|care|size|…)',
  related_product_click: 'Clicked a related product',
  add_to_cart: 'Added to cart (value = line value)',
  remove_from_cart: 'Removed from cart',
  cart_qty_change: 'Changed a cart quantity (props.from, props.to)',
  cart_view: 'Opened the cart',
  // Checkout
  checkout_start: 'Opened checkout',
  otp_sent: 'Checkout OTP sent',
  otp_verified: 'Checkout OTP verified',
  otp_failed: 'Checkout OTP wrong/expired (props.reason)',
  phone: 'Entered a phone number (funnel step)',
  address: 'Entered an address (funnel step)',
  coupon_apply: 'Tried a coupon (props.code, props.valid)',
  payment_method: 'Chose a payment method (props.method)',
  payment_start: 'Payment window opened',
  payment_success: 'Payment succeeded (value, currency)',
  payment_failed: 'Payment failed (props.reason)',
  // Discovery + contact
  search: 'Searched the site (props.q, props.results)',
  contact_click: 'Tapped WhatsApp / call / email (props.channel)',
  // Bookings
  booking_step: 'Reached a Try at Home / Private Viewing step (props.flow, props.step, …)',
  booking_submitted: 'Submitted a booking (props.flow)',
  tryhome_switch_to_viewing: 'Left Try at Home for Private Viewing (outside Mumbai)',
  // Site health
  web_vital: 'Core Web Vital (props.metric: LCP|INP|CLS, value, props.rating)',
  js_error: 'Uncaught script error (props.message, props.source)',
} as const;

export type EventName = keyof typeof EVENTS;

// Existing panel/step families keep their own names: vp_* booking prompt,
// cx_* cart "Before you go" panel, th_* Try at Home page steps.
const FAMILY = /^(vp|cx|th)_[a-z0-9_]{1,40}$/;

export function isEventName(n: unknown): n is string {
  return typeof n === 'string' && (Object.prototype.hasOwnProperty.call(EVENTS, n) || FAMILY.test(n));
}

// ── Payload cleaning ─────────────────────────────────────────────────────────

export const MAX_BATCH = 25;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ID = /^[A-Za-z0-9_-]{8,64}$/;

export function str(v: unknown, n = 120): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s ? s.slice(0, n) : null;
}

// Path only — query strings can carry tokens/emails and would split one page into many.
export function cleanPath(v: unknown): string | null {
  const s = str(v, 300);
  if (!s) return null;
  const p = s.split(/[?#]/)[0];
  return p.startsWith('/') ? p.slice(0, 200) : null;
}

// props: a flat object of short scalars. Anything nested or long is dropped, so a
// page can't stuff PII or megabytes into the event log.
export function cleanProps(v: unknown): Record<string, string | number | boolean | null> {
  const out: Record<string, string | number | boolean | null> = {};
  if (!v || typeof v !== 'object' || Array.isArray(v)) return out;
  let n = 0;
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (n >= 20 || !/^[a-z][a-z0-9_]{0,39}$/i.test(k)) continue;
    if (typeof val === 'number') { if (Number.isFinite(val)) out[k] = val; }
    else if (typeof val === 'boolean' || val === null) out[k] = val;
    else if (typeof val === 'string') out[k] = val.slice(0, 200);
    else continue;
    n++;
  }
  return out;
}

export interface CleanEvent {
  event_id: string;
  name: string;
  client_ts: string | null;
  page: string | null;
  page_view_id: string | null;
  product: string | null;
  value: number | null;
  currency: string | null;
  props: Record<string, string | number | boolean | null>;
}

// Returns the clean event, or a short rejection reason (counted in collect_rejects).
export function cleanEvent(e: unknown): CleanEvent | string {
  if (!e || typeof e !== 'object') return 'not_object';
  const r = e as Record<string, unknown>;
  if (typeof r.id !== 'string' || !UUID.test(r.id)) return 'bad_event_id';
  if (!isEventName(r.name)) return 'unknown_event';
  const t = typeof r.ts === 'number' ? r.ts : NaN;
  const value = typeof r.value === 'number' && Number.isFinite(r.value) ? Math.round(r.value * 100) / 100 : null;
  return {
    event_id: r.id.toLowerCase(),
    name: r.name as string,
    // A browser clock can be wildly off; keep it only as an ordering hint.
    client_ts: Number.isFinite(t) && t > 1.6e12 && t < 4.1e12 ? new Date(t).toISOString() : null,
    page: cleanPath(r.page),
    page_view_id: typeof r.pv === 'string' && UUID.test(r.pv) ? r.pv.toLowerCase() : null,
    product: str(r.product, 120),
    value,
    currency: str(r.currency, 8)?.toUpperCase() ?? null,
    props: cleanProps(r.props),
  };
}

export function isId(v: unknown): v is string {
  return typeof v === 'string' && ID.test(v);
}

// ── Attribution ──────────────────────────────────────────────────────────────

export interface Touch {
  referrer?: string | null;
  utm_source?: string | null;
  utm_medium?: string | null;
  utm_campaign?: string | null;
  fbclid?: string | null;
  gclid?: string | null;
  affiliate?: string | null;
}

const SOCIAL: Record<string, string> = {
  'instagram.com': 'instagram', 'l.instagram.com': 'instagram',
  'facebook.com': 'facebook', 'm.facebook.com': 'facebook', 'l.facebook.com': 'facebook', 'lm.facebook.com': 'facebook',
  'pinterest.com': 'pinterest', 'in.pinterest.com': 'pinterest', 'pin.it': 'pinterest',
  'linkedin.com': 'linkedin', 'lnkd.in': 'linkedin',
  't.co': 'x', 'x.com': 'x', 'twitter.com': 'x',
  'youtube.com': 'youtube', 'm.youtube.com': 'youtube',
  'whatsapp.com': 'whatsapp', 'wa.me': 'whatsapp', 'web.whatsapp.com': 'whatsapp',
};
const SEARCH = /(^|\.)(google|bing|duckduckgo|yahoo|ecosia|yandex|baidu)\.[a-z.]+$/;

function host(url: string | null | undefined): string {
  if (!url) return '';
  try { return new URL(url).hostname.replace(/^www\./, '').toLowerCase(); } catch { return ''; }
}

// Source / medium for one visit, GA-style, so our channels line up with GA's.
// Priority: explicit UTM > ad click id > affiliate link > referrer > direct.
export function sourceMedium(t: Touch): { source: string; medium: string } {
  const us = str(t.utm_source, 60)?.toLowerCase();
  if (us) return { source: us, medium: str(t.utm_medium, 60)?.toLowerCase() || 'unknown' };
  if (t.gclid) return { source: 'google', medium: 'cpc' };
  if (t.fbclid) return { source: SOCIAL[host(t.referrer)] || 'facebook', medium: 'paid_social' };
  if (t.affiliate) return { source: `affiliate:${t.affiliate.toLowerCase()}`, medium: 'affiliate' };
  const h = host(t.referrer);
  if (!h) return { source: 'direct', medium: 'none' };
  if (SOCIAL[h]) return { source: SOCIAL[h], medium: 'social' };
  const m = h.match(SEARCH);
  if (m) return { source: m[2], medium: 'organic' };
  return { source: h, medium: 'referral' };
}

// ── Identity ─────────────────────────────────────────────────────────────────

// Same rule as the old leads.ts personKey (now retired): last 10 digits, else nothing.
export function personKey(phone: unknown): string {
  const d = String(phone ?? '').replace(/[^0-9]/g, '');
  return d.length >= 10 ? d.slice(-10) : '';
}

export function personIdFor(phone: unknown, email: unknown): string {
  const k = personKey(phone);
  if (k) return k;
  const e = str(email, 200)?.toLowerCase();
  return e && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e) ? `e:${e}` : '';
}
