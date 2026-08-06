import type { APIRoute } from 'astro';
import { recordClick, SLUG_RE } from '~/lib/clicks';
import { setClickId } from '~/lib/cart-session';

export const prerender = false;

// Affiliate landing: https://mirkash.com/api/go/{slug}?to=/products/some-bag
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

export const GET: APIRoute = async ({ params, url, cookies }) => {
  const slug = (params.affiliate || '').toLowerCase();
  const to = safePath(url.searchParams.get('to'));

  if (SLUG_RE.test(slug)) {
    const clickId = await recordClick(slug, to);
    if (clickId) setClickId(cookies, clickId);
  }

  return new Response(null, {
    status: 302,
    headers: { Location: to, 'Cache-Control': 'no-store' },
  });
};
