// GET: all products. POST (form: name, notes, files): start a new product that waits for Claude Code.
import type { APIRoute } from 'astro';
import { addInboxPhotos, createPending, listProducts } from '../lib/catalog';
import { json, fail } from '../lib/http';

export const GET: APIRoute = () => json(listProducts());

export const POST: APIRoute = async ({ request }) => {
  try {
    const form = await request.formData();
    const id = createPending(String(form.get('name') ?? ''), String(form.get('notes') ?? ''));
    await addInboxPhotos(id, form.getAll('files').filter((f): f is File => f instanceof File && f.size > 0));
    return json({ id });
  } catch (e) {
    return fail(e);
  }
};
