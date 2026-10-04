// Adds photos. Form fields: files, and either folder (a colour, after its last photo) or inbox=1 (loose, for Claude Code to sort).
import type { APIRoute } from 'astro';
import { readProduct, addPhotos, addInboxPhotos, inboxPhotos, isPending, productExists } from '../lib/catalog';
import { colourPhotoInfo } from '../lib/state';
import { slug } from '../lib/paths.mjs';
import { json, fail } from '../lib/http';

export const POST: APIRoute = async ({ params, request }) => {
  try {
    const id = params.id!;
    const key = productExists(id) ? readProduct(id).key : isPending(id) ? id : '';
    if (!key) throw new Error('Unknown product');
    const form = await request.formData();
    const files = form.getAll('files').filter((f): f is File => f instanceof File && f.size > 0);
    if (form.get('inbox') === '1') {
      await addInboxPhotos(key, files);
      return json({ photos: inboxPhotos(key) });
    }
    const folder = slug(String(form.get('folder') ?? ''));
    if (!folder) throw new Error('Name the colour before adding photos');
    await addPhotos(key, folder, files);
    return json({ folder, photos: await colourPhotoInfo(key, folder) });
  } catch (e) {
    return fail(e);
  }
};
