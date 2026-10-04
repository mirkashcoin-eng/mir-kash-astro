// The catalog tool (/catalog-tool) exists only when the site runs locally (`astro dev`, started by
// "Mir Kash Catalog.command"). It reads and writes files in catalog/ and pushes to Shopify, so it is never added
// to a production build: on Vercel these routes don't exist at all.
const ROUTES = [
  ['/catalog-tool', 'pages/index.astro'],
  ['/catalog-tool/[id]', 'pages/edit.astro'],
  ['/catalog-tool/[id]/preview', 'pages/preview.astro'],
  ['/catalog-tool/[id]/waiting', 'pages/waiting.astro'],
  ['/catalog-tool/photo/[...path]', 'api/photo.ts'],
  ['/catalog-tool/api/products', 'api/products.ts'],
  ['/catalog-tool/api/product/[id]', 'api/product.ts'],
  ['/catalog-tool/api/photos/[id]', 'api/photos.ts'],
  ['/catalog-tool/api/pending/[id]', 'api/pending.ts'],
  ['/catalog-tool/api/asset/[id]', 'api/asset.ts'],
  ['/catalog-tool/api/prompt/[id]', 'api/prompt.ts'],
  ['/catalog-tool/api/taxonomy', 'api/taxonomy.ts'],
  ['/catalog-tool/api/push/[id]', 'api/push.ts'],
  ['/catalog-tool/api/open/[id]', 'api/open.ts'],
];

export default function catalogTool() {
  return {
    name: 'mir-kash-catalog-tool',
    hooks: {
      'astro:config:setup': ({ command, injectRoute }) => {
        if (command !== 'dev') return;
        for (const [pattern, file] of ROUTES) injectRoute({ pattern, entrypoint: `./src/catalog-tool/${file}`, prerender: false });
      },
    },
  };
}
