import type { APIRoute } from 'astro';
import { buildPrompt } from '../lib/prompt';
import { fail } from '../lib/http';

export const GET: APIRoute = async ({ params }) => {
  try {
    return new Response(await buildPrompt(params.id!), { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });
  } catch (e) {
    return fail(e);
  }
};
