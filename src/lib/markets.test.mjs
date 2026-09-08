// Self-check for market routing: which market a visitor lands in, and how a manual
// choice survives the round trip. Run: node src/lib/markets.test.mjs
import assert from 'node:assert/strict';

// ── Mirrors src/lib/markets.ts ──────────────────────────────────────────────
const INDIA = { localeSlug: '', urlPrefix: '', countryCode: 'IN', isDefault: true };
const MARKETS = [
  INDIA,
  { localeSlug: 'en-us', urlPrefix: '/en-us', countryCode: 'US' },
  { localeSlug: 'en-gb', urlPrefix: '/en-gb', countryCode: 'GB' },
];
const INDIA_COOKIE_VALUE = 'in';
const getMarketBySlug = (slug) => MARKETS.find((m) => m.localeSlug === slug);
const marketCookieValue = (m) => m.localeSlug || INDIA_COOKIE_VALUE;
const getMarketByCookie = (v) =>
  !v ? undefined : v === INDIA_COOKIE_VALUE ? INDIA : getMarketBySlug(v);
const parseLocaleFromPath = (p) => (p.match(/^\/(en-[a-z]{2})(?:\/|$)/) || [])[1] ?? null;
const stripMarketPrefix = (p) => {
  const slug = parseLocaleFromPath(p);
  return slug ? p.slice(`/${slug}`.length) || '/' : p;
};
const getAlternateUrl = (p, t) => {
  const bare = stripMarketPrefix(p);
  return !t.urlPrefix ? bare || '/' : bare === '/' ? t.urlPrefix : t.urlPrefix + bare;
};

// ── THE BUG: India's cookie value must be readable by the server ────────────
// India's slug is '', and Astro's cookies.get() drops empty-valued cookies
// (it guards on `if (value)`), so writing '' made the choice invisible and the
// visitor was geo-redirected back to /en-us forever.
assert.equal(marketCookieValue(INDIA), 'in', "India's cookie value must not be empty");
assert.ok(marketCookieValue(INDIA), 'must be truthy or Astro discards it');
for (const m of MARKETS) {
  assert.ok(marketCookieValue(m), `every market needs a truthy cookie value: ${m.countryCode}`);
  assert.equal(getMarketByCookie(marketCookieValue(m)), m, 'cookie value must round-trip');
}
// Absent / unrecognised cookies fall through to geo rather than picking a wrong market.
for (const junk of ['', undefined, null, 'en-zz', 'nonsense']) {
  assert.equal(getMarketByCookie(junk), undefined, `must not resolve ${JSON.stringify(junk)}`);
}

// ── The middleware decision (mirrors src/middleware.ts) ─────────────────────
const SKIP = [
  /^\/api\//, /^\/_astro\//, /^\/_image/, /^\/favicon/, /^\/sitemap/, /^\/robots\.txt$/,
  /^\/admin(\/|$)/, /^\/go(\/|$)/, /^\/account(\/|$)/, /^\/checkout(\/|$)/,
  /^\/try-at-home(\/|$)/, /^\/private-viewing(\/|$)/, /^\/viewing(\/|$)/,
  /^\/blog(\/|$)/, /^\/pages\/about(\/|$)/, /^\/pages\/materials(\/|$)/,
];
function route(pathname, search, cookie, geoCountry) {
  if (SKIP.some((re) => re.test(pathname)) || pathname.includes('.')) return null;
  if (parseLocaleFromPath(pathname)) return null;
  if (cookie) {
    const chosen = getMarketByCookie(cookie);
    if (chosen && !chosen.isDefault) return getAlternateUrl(pathname, chosen) + search;
    return null; // India, or unknown cookie → stay at root
  }
  if (geoCountry) {
    const geo = MARKETS.find((m) => m.countryCode === geoCountry) ?? getMarketBySlug('en-us');
    if (!geo.isDefault) return getAlternateUrl(pathname, geo) + search;
  }
  return null;
}

// The reported bug, end to end: US visitor picks India → must STAY on the root site.
assert.equal(route('/', '', 'in', 'US'), null, 'India choice must beat US geo');
assert.equal(route('/shop', '', 'in', 'US'), null, 'and on every other root path');
// The old broken value must no longer be produced, but if an old cookie lingers it
// must fail safe (fall through to geo) rather than resolve to something wrong.
assert.equal(route('/', '', '', 'US'), '/en-us', 'empty cookie → geo, same as no choice');
// Other directions still work.
assert.equal(route('/', '', 'en-gb', 'US'), '/en-gb', 'explicit UK choice wins over US geo');
assert.equal(route('/', '', null, 'US'), '/en-us', 'no choice → geo');
assert.equal(route('/', '', null, 'IN'), null, 'Indian visitor stays at root');
assert.equal(route('/en-us/shop', '', 'in', 'US'), null, 'explicit locale URL is respected');

// ── Query string must survive the redirect (ad attribution) ─────────────────
assert.equal(route('/', '?utm_source=ig&gclid=abc', null, 'US'), '/en-us?utm_source=ig&gclid=abc');
assert.equal(route('/shop', '?filter=totes', null, 'US'), '/en-us/shop?filter=totes');
assert.equal(route('/', '', null, 'US'), '/en-us', 'no query → no stray ?');

// ── Root-only routes must never be geo-redirected (they 404 under /en-xx) ───
for (const p of ['/go/priya', '/account', '/checkout', '/try-at-home', '/private-viewing', '/viewing/abc']) {
  assert.equal(route(p, '', null, 'US'), null, `${p} has no /en-xx counterpart — must not redirect`);
}

// ── Affiliate destination (mirrors go/[affiliate].ts) ───────────────────────
// The click is recorded first, THEN the visitor is sent to their own market.
const affiliateDest = (to, market) => (market && !market.isDefault ? getAlternateUrl(to, market) : to);
assert.equal(affiliateDest('/products/x', INDIA), '/products/x', 'Indian visitor → root product');
assert.equal(affiliateDest('/products/x', getMarketBySlug('en-us')), '/en-us/products/x', 'US visitor → localized');
assert.equal(affiliateDest('/', getMarketBySlug('en-us')), '/en-us', 'bare root → market home');
assert.equal(affiliateDest('/products/x', undefined), '/products/x', 'no market resolved → unchanged');

console.log('markets self-check: all assertions passed');
