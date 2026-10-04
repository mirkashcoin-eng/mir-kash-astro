import type { APIRoute } from 'astro';
import { createProduct, listProducts } from '../lib/catalog';
import { json, fail } from '../lib/http';

export const GET: APIRoute = () => json(listProducts());

export const POST: APIRoute = async ({ request }) => {
  try {
    const { name } = await request.json();
    return json({ id: createProduct(String(name ?? '').trim()) });
  } catch (e) {
    return fail(e);
  }
};
