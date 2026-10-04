// Adds a story close-up or a banner image (form fields: kind = story | banner, file).
import type { APIRoute } from 'astro';
import { readProduct, addAsset, photoUrl } from '../lib/catalog';
import { json, fail } from '../lib/http';

export const POST: APIRoute = async ({ params, request }) => {
  try {
    const P = readProduct(params.id!);
    const form = await request.formData();
    const kind = form.get('kind') === 'banner' ? 'banner' : 'story';
    const file = form.get('file');
    if (!(file instanceof File)) throw new Error('No file');
    const rel = await addAsset(P.key, kind, file);
    return json({ path: rel, url: photoUrl(P.key, rel, 800) });
  } catch (e) {
    return fail(e);
  }
};
