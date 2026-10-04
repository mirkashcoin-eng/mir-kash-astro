// While a product waits for Claude Code: GET its notes and loose photos, PUT new notes.
import type { APIRoute } from 'astro';
import { inboxPhotos, isPending, readNotes, readPending, writeNotes } from '../lib/catalog';
import { json, fail } from '../lib/http';

export const GET: APIRoute = ({ params }) => {
  try {
    const id = params.id!;
    if (!isPending(id)) return fail('Not waiting', 404);
    const { name } = readPending(id);
    return json({ name, notes: readNotes(name), photos: inboxPhotos(id) });
  } catch (e) {
    return fail(e);
  }
};

export const PUT: APIRoute = async ({ params, request }) => {
  try {
    const id = params.id!;
    if (!isPending(id)) return fail('Not waiting', 404);
    const { notes } = await request.json();
    if (!String(notes ?? '').trim()) throw new Error('The notes are empty');
    writeNotes(readPending(id).name, String(notes));
    return json({ ok: true });
  } catch (e) {
    return fail(e);
  }
};
