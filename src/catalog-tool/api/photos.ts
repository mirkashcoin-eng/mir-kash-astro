// Adds photos to one colour (form fields: folder, files). They go after the colour's existing photos.
import type { APIRoute } from 'astro';
import { readProduct, addPhotos } from '../lib/catalog';
import { colourPhotoInfo } from '../lib/state';
import { slug } from '../lib/paths.mjs';
import { json, fail } from '../lib/http';

export const POST: APIRoute = async ({ params, request }) => {
  try {
    const P = readProduct(params.id!);
    const form = await request.formData();
    const folder = slug(String(form.get('folder') ?? ''));
    if (!folder) throw new Error('Name the colour before adding photos');
    const files = form.getAll('files').filter((f): f is File => f instanceof File);
    await addPhotos(P.key, folder, files);
    return json({ folder, photos: await colourPhotoInfo(P.key, folder) });
  } catch (e) {
    return fail(e);
  }
};
