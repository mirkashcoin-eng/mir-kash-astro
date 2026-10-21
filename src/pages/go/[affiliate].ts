import type { APIRoute } from 'astro';
import { recordClick, SLUG_RE } from '~/lib/clicks';
import { setClickId } from '~/lib/cart-session';
import { getAlternateUrl } from '~/lib/markets';

export const prerender = false;

// Affiliate landing: https://mirkash.com/go/{slug}?to=/products/some-bag
// Mints a click id, logs it against the affiliate, drops it in a cookie, then sends
// the visitor on. The cookie is read at checkout so the order carries the click id.
//
// An unknown or malformed slug still redirects (just untracked) — a creator's link
// should never show a visitor an error page.

// `to` comes from the URL, so treat it as hostile: only same-site absolute paths.
// `//evil.com` and `https://evil.com` are both rejected — otherwise these links
// would be an open redirect wearing our domain.
function safePath(raw: string | null): string {
  if (!raw) return '/';
  if (!raw.startsWith('/') || raw.startsWith('//')) return '/';
  return raw;
}

// Credit the visit (not just the order) to the affiliate in analytics. The click-id
// cookie above only reaches checkout; the browser tracker (BaseLayout) and GA4 both
// read UTM tags from the landing URL, and a new utm_source also starts a new visit,
// so the creator gets the session even if this browser was here minutes ago.
// A link that already carries its own UTM tags keeps them untouched.
function withAffiliateUtm(path: string, slug: string): string {
  const u = new URL(path, 'https://x.invalid');
  if (u.searchParams.has('utm_source')) return path;
  u.searchParams.set('utm_source', slug);
  u.searchParams.set('utm_medium', 'affiliate');
  return u.pathname + u.search + u.hash;
}

export const GET: APIRoute = async ({ params, url, cookies, locals }) => {
  const slug = (params.affiliate || '').toLowerCase();
  const to = safePath(url.searchParams.get('to'));

  if (SLUG_RE.test(slug)) {
    const clickId = await recordClick(slug, to);
    if (clickId) setClickId(cookies, clickId);
  }

  // Record the click FIRST, then send the visitor to their own market. This route is
  // in the middleware's SKIP_PATHS precisely so it gets to run: the geo redirect used
  // to fire first and rewrite /go/{slug} to /en-us/go/{slug}, which does not exist —
  // so the visitor 404'd, the click was never logged and the sale lost its affiliate.
  // Creator links are shared as bare paths (/products/x), so a US visitor still needs
  // the /en-us prefix added here.
  const market = locals.marketConfig;
  let destination = market && !market.isDefault ? getAlternateUrl(to, market) : to;
  if (SLUG_RE.test(slug)) destination = withAffiliateUtm(destination, slug);

  return new Response(null, {
    status: 302,
    headers: { Location: destination, 'Cache-Control': 'no-store' },
  });
};
