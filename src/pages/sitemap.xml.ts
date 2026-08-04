import type { APIRoute } from 'astro';
import { SITE_ORIGIN } from '~/lib/markets';
import { getAllProducts } from '~/lib/shopify/queries';
import { POSTS } from '~/data/journal';

export const prerender = false;

// Route prefixes that must never appear in the sitemap (not indexable / not pages).
const EXCLUDE = ['/api', '/cart', '/checkout', '/account', '/admin', '/404', '/sitemap'];
const isExcluded = (p: string) => EXCLUDE.some((x) => p === x || p.startsWith(x + '/'));

// Auto-discover every static page from the file system, so a newly added page is
// picked up automatically — no manual list to maintain. Dynamic routes (with [param])
// and the localised [locale] duplicates are handled/skipped below.
function staticPaths(): string[] {
  const modules = import.meta.glob('./**/*.astro');
  const paths = new Set<string>();
  for (const key of Object.keys(modules)) {
    if (key.includes('[')) continue; // dynamic route — expanded separately
    let path = key.replace(/^\.\//, '/').replace(/\.astro$/, '').replace(/\/index$/, '');
    if (path === '/index' || path === '') path = ''; // home
    if (isExcluded(path)) continue;
    paths.add(path);
  }
  return [...paths];
}

interface Entry { path: string; lastmod?: string }

export const GET: APIRoute = async () => {
  const entries: Entry[] = staticPaths().map((path) => ({ path }));

  // Journal articles (auto — every post in the data module, with its publish date).
  for (const post of POSTS) entries.push({ path: `/blog/${post.slug}`, lastmod: post.date });

  // Product pages (auto — pulled live from Shopify).
  try {
    const products = await getAllProducts('india', 'IN', 100);
    for (const p of products) if (p.handle) entries.push({ path: `/products/${p.handle}` });
  } catch {
    // If Shopify is unreachable, still serve a valid sitemap of the known pages.
  }

  // De-dupe and give a stable order.
  const seen = new Set<string>();
  const unique = entries.filter((e) => (seen.has(e.path) ? false : seen.add(e.path)));

  const xml =
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    unique
      .map((e) => {
        const loc = `${SITE_ORIGIN}${e.path}`.replace(/&/g, '&amp;');
        return `  <url><loc>${loc}</loc>${e.lastmod ? `<lastmod>${e.lastmod}</lastmod>` : ''}</url>`;
      })
      .join('\n') +
    '\n</urlset>\n';

  return new Response(xml, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      // Revalidated hourly at the CDN; always regenerated fresh on origin.
      'Cache-Control': 'public, max-age=3600, s-maxage=3600',
    },
  });
};
