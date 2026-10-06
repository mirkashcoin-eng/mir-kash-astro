// Server-side mirror of the Meta Pixel, via the Conversions API — same two events the
// browser pixel sends (AddToCart, Purchase in BaseLayout/ProductPage/checkout/return),
// sent again from the server so ad blockers and iOS tracking prevention don't lose them.
// India-only, same as the browser Purchase event: the hooks here (completeDraftOrder,
// /api/cart/add) only ever run India's own checkout. Global/US purchases finish on
// Shopify's own checkout, which has its own separate pixel/CAPI setup in Shopify admin.
import crypto from 'node:crypto';

const PIXEL_ID = '1169633797586706'; // same id as the browser pixel in BaseLayout.astro — public by design
const API_VERSION = 'v21.0';

const token = () => (typeof process !== 'undefined' ? process.env.META_CAPI_TOKEN : undefined);
export const metaCapiConfigured = (): boolean => !!token();

// Meta requires em/ph lower-cased and trimmed before hashing; phone must be digits only
// (with country code, no leading +, no punctuation) before hashing.
const sha256 = (v: string) => crypto.createHash('sha256').update(v).digest('hex');
const hashEmail = (email: string) => sha256(email.trim().toLowerCase());
const hashPhone = (phone: string) => {
  const digits = phone.replace(/[^\d]/g, '');
  return digits ? sha256(digits) : undefined;
};

export interface MetaCapiUserData {
  email?: string | null;
  phone?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  fbp?: string | null;
  fbc?: string | null;
  externalId?: string | null; // e.g. the order name — hashed like em/ph per Meta's spec
}

export interface MetaCapiEvent {
  eventName: string;
  eventId: string; // shared with the matching browser Pixel event's eventID, for dedup
  sourceUrl: string;
  user: MetaCapiUserData;
  customData?: Record<string, unknown>;
}

// Fire-and-forget by design: ad attribution must never affect checkout or cart. Errors
// are caught and logged, never thrown — same posture as src/lib/whatsapp.ts.
export async function sendMetaEvent(e: MetaCapiEvent): Promise<void> {
  const accessToken = token();
  if (!accessToken) return;
  try {
    const user_data: Record<string, unknown> = {};
    if (e.user.email) user_data.em = [hashEmail(e.user.email)];
    const ph = e.user.phone ? hashPhone(e.user.phone) : undefined;
    if (ph) user_data.ph = [ph];
    if (e.user.ip) user_data.client_ip_address = e.user.ip;
    if (e.user.userAgent) user_data.client_user_agent = e.user.userAgent;
    if (e.user.fbp) user_data.fbp = e.user.fbp;
    if (e.user.fbc) user_data.fbc = e.user.fbc;
    if (e.user.externalId) user_data.external_id = [sha256(e.user.externalId.trim().toLowerCase())];

    const res = await fetch(
      `https://graph.facebook.com/${API_VERSION}/${PIXEL_ID}/events?access_token=${encodeURIComponent(accessToken)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          data: [
            {
              event_name: e.eventName,
              event_time: Math.floor(Date.now() / 1000),
              event_id: e.eventId,
              action_source: 'website',
              event_source_url: e.sourceUrl,
              user_data,
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
