// GET: everything the editor shows. PUT: save the editor (product file, notes, photo order/labels, colour folders).
import type { APIRoute } from 'astro';
import { productExists, productStamp, isPending, readProduct, writeProduct, writeNotes, arrangePhotos, renameColourFolder, tidyAssets, type ProductFile } from '../lib/catalog';
import { editorState } from '../lib/state';
import { slug } from '../lib/paths.mjs';
import { json, fail } from '../lib/http';

export const GET: APIRoute = async ({ params, url }) => {
  const id = params.id!;
  // ?stamp: a cheap "has the file appeared or changed?" check, polled while waiting for Claude Code.
  if (url.searchParams.has('stamp')) {
    try {
      const exists = productExists(id);
      let error = '';
      if (exists) { try { readProduct(id); } catch (e) { error = e instanceof Error ? e.message : String(e); } }
      return json({ exists, pending: isPending(id), stamp: productStamp(id), error });
    } catch (e) { return fail(e); }
  }
  try { return json(await editorState(id)); } catch (e) { return fail(e, 404); }
};

type SaveBody = { P: ProductFile; notes: string; photos?: Record<string, { order: Array<{ file: string; label: string }>; removed: string[] }> };

export const PUT: APIRoute = async ({ params, request }) => {
  try {
    const id = params.id!;
    const old = readProduct(id);
    const body = (await request.json()) as SaveBody;
    const P = body.P;
    // These are owned by the server: the photo folder key, and the record of what was uploaded/pushed.
    P.key = old.key;
    P.name = old.name || P.name;
    P.uploads = old.uploads;
    P.pushed = old.pushed;
    for (const [folder, o] of Object.entries(body.photos ?? {})) arrangePhotos(P.key, folder, o.order ?? [], o.removed ?? []);
    const seen = new Set<string>();
    P.colours = P.colours.filter((c) => c.name.trim()).map((c) => {
      const want = slug(c.name);
      if (seen.has(want)) throw new Error(`Two colours are called "${c.name}"`);
      seen.add(want);
      return { ...c, name: c.name.trim(), folder: renameColourFolder(P.key, c.folder, want) };
    });
    writeProduct(id, P);
    writeNotes(P.name || P.title, body.notes ?? '');
    tidyAssets(P);
    return json(await editorState(id));
  } catch (e) {
    return fail(e);
  }
};
