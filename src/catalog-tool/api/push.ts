// Pushes the saved product file to one store and streams the progress, one line at a time.
import type { APIRoute } from 'astro';
import { readProduct, writeProduct, type ProductFile } from '../lib/catalog';
import { colourPhotos } from '../lib/photos.mjs';
import { pushProduct } from '../lib/push.mjs';
import { fail } from '../lib/http';

const running = new Set<string>();

function problems(P: ProductFile, store: 'india' | 'global'): string[] {
  const where = store === 'india' ? 'India' : 'Global';
  const out: string[] = [];
  if (!P.title.trim()) out.push('The title is empty');
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(P.handle)) out.push('The web address (handle) is empty or has characters other than a–z, 0–9 and dashes');
  if (!P.productType.trim()) out.push('The product type is empty');
  if (!P.category) out.push('No Shopify category chosen');
  if (!(Number(P.price[store]) > 0)) out.push(`No ${where} price`);
  if (!P.colours.length) out.push('No colours');
  for (const c of P.colours) if (!colourPhotos(P.key, c.folder).length) out.push(`${c.name} has no photos`);
  if (!P.descriptionHtml.replace(/<[^>]+>/g, '').trim()) out.push('The description is empty');
  if (!P.seoTitle.trim()) out.push('The Google title is empty');
  if (!P.seoDescription[store]?.trim()) out.push(`The ${where} Google description is empty`);
  return out;
}

export const POST: APIRoute = async ({ params, url }) => {
  const id = params.id!;
  const store = url.searchParams.get('store');
  const dryRun = url.searchParams.get('dry') === '1';
  if (store !== 'india' && store !== 'global') return fail('Choose india or global');
  let P: ProductFile;
  try { P = readProduct(id); } catch (e) { return fail(e, 404); }
  if (running.has(id)) return fail('A push for this product is already running');

  const issues = problems(P, store);
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const log = (line: string) => controller.enqueue(enc.encode(line + '\n'));
      if (issues.length) {
        log(`✗ Not pushed. Fix these first:`);
        issues.forEach((i) => log(`   • ${i}`));
        log('FAILED');
        controller.close();
        return;
      }
      running.add(id);
      try {
        const out = await pushProduct(P, store, { log, dryRun });
        if (!dryRun) {
          const fresh = readProduct(id);
          fresh.uploads = out.uploads;
          fresh.pushed = out.pushed;
          writeProduct(id, fresh);
        }
        log('FINISHED');
      } catch (e) {
        log(`✗ ${e instanceof Error ? e.message : String(e)}`);
        log('FAILED');
      } finally {
        running.delete(id);
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
};
