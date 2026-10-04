import { defineConfig } from 'astro/config';
import vercel from '@astrojs/vercel';
import catalogTool from './src/catalog-tool/integration.mjs';

export default defineConfig({
  site: 'https://mirkash.com',
  output: 'server',
  // NB: edgeMiddleware:true was tried here to put market routing in front of the CDN
  // cache (bundled in the function, middleware sits *behind* it, so a cached page skips
  // the geo/cookie check entirely). The adapter emitted a route table where every path
  // dests to _middleware and _render.func is unreachable, which would break the site.
  // Left off until that can be validated on a preview deploy.
  adapter: vercel(),
  integrations: [catalogTool()],
  // Hidden when the catalog tool is opened from "Mir Kash Catalog.command", so the founder doesn't see dev controls.
  devToolbar: { enabled: process.env.MK_CATALOG !== '1' },
  trailingSlash: 'never',
  // The Try at Home page moved off /book-demo. Kept as a permanent redirect so
  // existing links, ad campaigns and the confirmation emails still land.
  redirects: {
    '/book-demo': { status: 301, destination: '/try-at-home' },
  },
});
