import { defineConfig } from 'astro/config';
import vercel from '@astrojs/vercel';

export default defineConfig({
  site: 'https://mirkash.com',
  output: 'server',
  adapter: vercel(),
  trailingSlash: 'never',
  // The Try at Home page moved off /book-demo. Kept as a permanent redirect so
  // existing links, ad campaigns and the confirmation emails still land.
  redirects: {
    '/book-demo': { status: 301, destination: '/try-at-home' },
  },
});
