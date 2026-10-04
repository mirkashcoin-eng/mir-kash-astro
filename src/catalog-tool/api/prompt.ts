import type { APIRoute } from 'astro';
import { readProduct } from '../lib/catalog';
import { buildPrompt } from '../lib/prompt';
import { fail } from '../lib/http';

export const GET: APIRoute = ({ params, url }) => {
  try {
    const text = buildPrompt(readProduct(params.id!), url.searchParams.get('care') !== '0');
    return new Response(text, { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });
  } catch (e) {
    return fail(e);
  }
};
