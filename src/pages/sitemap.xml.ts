import type { APIRoute } from 'astro';
import { SITE_ORIGIN } from '~/lib/markets';
import { getAllProducts } from '~/lib/shopify/queries';
import { POSTS } from '~/data/journal';

export const prerender = false;

// Static, indexable pages (India / root market — the canonical URLs).
const STATIC_PATHS = [
  '',
  '/shop',
  '/blog',
  '/book-demo',
  '/pages/about',
  '/pages/materials',
  '/pages/faq',
  '/pages/contact',
  '/pages/bulk-gifting',
  '/pages/shipping-returns',
  '/pages/returns-portal',
  '/pages/terms-conditions',
  '/pages/privacy-policy',
  '/pages/accessibility',
];

interface Entry { path: string; lastmod?: string }

export const GET: APIRoute = async () => {
  const entries: Entry[] = STATIC_PATHS.map((path) => ({ path }));

  // Journal articles (with their publish date).
  for (const post of POSTS) {
    entries.push({ path: `/blog/${post.slug}`, lastmod: post.date });
  }

  // Product pages.
  try {
    const products = await getAllProducts('india', 'IN', 100);
    for (const p of products) {
      if (p.handle) entries.push({ path: `/products/${p.handle}` });
    }
  } catch {
    // If Shopify is unreachable, still serve a valid sitemap of the known pages.
  }

  const xml =
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    entries
      .map((e) => {
        const loc = `${SITE_ORIGIN}${e.path}`.replace(/&/g, '&amp;');
        return `  <url><loc>${loc}</loc>${e.lastmod ? `<lastmod>${e.lastmod}</lastmod>` : ''}</url>`;
      })
      .join('\n') +
    '\n</urlset>\n';

  return new Response(xml, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=3600, s-maxage=3600',
    },
  });
};
