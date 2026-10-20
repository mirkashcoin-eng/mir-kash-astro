// Server-side mirror of the Meta Pixel, via the Conversions API — the browser events
// (AddToCart, Purchase, Schedule in ProductPage/checkout/return/BookDemo) sent again from
// the server so ad blockers and iOS tracking prevention don't lose them, plus the
// offline Try at Home outcomes (visit completed) that have no browser event at all.
// India-only, same as the browser Purchase event: the hooks here (completeDraftOrder,
// /api/cart/add, /api/book-demo, completeDemo) only ever run India's own flows. Global/US
// purchases finish on Shopify's own checkout, which has its own separate pixel/CAPI setup
// in Shopify admin.
import crypto from 'node:crypto';

const PIXEL_ID = '1169633797586706'; // same id as the browser pixel in BaseLayout.astro — public by design
const API_VERSION = 'v26.0';

const token = () => (typeof process !== 'undefined' ? process.env.META_CAPI_TOKEN : undefined);
export const metaCapiConfigured = (): boolean => !!token();

// Normalisation follows Meta's customer-information parameter spec: lower-case and trim
// everything; phone digits only with country code; city with no spaces or punctuation;
// country as a 2-letter ISO code. All of these are SHA-256 hashed before sending.
const sha256 = (v: string) => crypto.createHash('sha256').update(v).digest('hex');
const hashLower = (v: string) => sha256(v.trim().toLowerCase());
const hashPhone = (phone: string) => {
  const digits = phone.replace(/[^\d]/g, '');
  return digits ? sha256(digits) : undefined;
};
const hashCity = (city: string) => {
  const c = city.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  return c ? sha256(c) : undefined;
};
const hashZip = (zip: string) => {
  const z = zip.toLowerCase().replace(/\s+/g, '');
  return z ? sha256(z) : undefined;
};

export interface MetaCapiUserData {
  email?: string | null;
  phone?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  city?: string | null;
  zip?: string | null;
  country?: string | null; // ISO 3166-1 alpha-2, e.g. 'IN'
  ip?: string | null;
  userAgent?: string | null;
  fbp?: string | null;
  fbc?: string | null;
  externalId?: string | null; // e.g. the order name — hashed like em/ph per Meta's spec
}

/** Builds Meta's user_data object. Exported for the self-check in meta-capi.test.mjs. */
export function buildUserData(u: MetaCapiUserData): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const put = (key: string, hashed: string | undefined) => { if (hashed) out[key] = [hashed]; };
  if (u.email?.trim()) put('em', hashLower(u.email));
  if (u.phone) put('ph', hashPhone(u.phone));
  if (u.firstName?.trim()) put('fn', hashLower(u.firstName));
  if (u.lastName?.trim()) put('ln', hashLower(u.lastName));
  if (u.city) put('ct', hashCity(u.city));
  if (u.zip) put('zp', hashZip(u.zip));
  if (u.country && /^[a-z]{2}$/i.test(u.country.trim())) put('country', hashLower(u.country));
  if (u.externalId?.trim()) put('external_id', hashLower(u.externalId));
  if (u.ip) out.client_ip_address = u.ip;
  if (u.userAgent) out.client_user_agent = u.userAgent;
  if (u.fbp) out.fbp = u.fbp;
  if (u.fbc) out.fbc = u.fbc;
  return out;
}

export interface MetaCapiEvent {
  eventName: string;
  eventId: string; // shared with the matching browser Pixel event's eventID, for dedup
  /** Required by Meta when actionSource is 'website' (the default). */
  sourceUrl?: string;
  user: MetaCapiUserData;
  customData?: Record<string, unknown>;
  /**
   * 'website' for anything a visitor did on the site. Try at Home outcomes happen at the
   * customer's home and are recorded later by a founder, so they use 'physical_store'.
   */
  actionSource?: 'website' | 'physical_store' | 'system_generated';
  /** Unix seconds; defaults to now. */
  eventTime?: number;
}

// Fire-and-forget by design: ad attribution must never affect checkout or cart. Errors
// are caught and logged, never thrown — same posture as src/lib/whatsapp.ts.
export async function sendMetaEvent(e: MetaCapiEvent): Promise<void> {
  const accessToken = token();
  if (!accessToken) return;
  try {
    const actionSource = e.actionSource ?? 'website';
    const res = await fetch(
      `https://graph.facebook.com/${API_VERSION}/${PIXEL_ID}/events?access_token=${encodeURIComponent(accessToken)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          data: [
            {
              event_name: e.eventName,
              event_time: e.eventTime ?? Math.floor(Date.now() / 1000),
              event_id: e.eventId,
              action_source: actionSource,
              ...(e.sourceUrl ? { event_source_url: e.sourceUrl } : {}),
              user_data: buildUserData(e.user),
              custom_data: e.customData,
            },
          ],
        }),
      },
    );
    if (!res.ok) console.error('[meta-capi]', e.eventName, res.status, (await res.text().catch(() => '')).slice(0, 500));
  } catch (err) {
    console.error('[meta-capi]', e.eventName, 'send failed', err);
  }
}
