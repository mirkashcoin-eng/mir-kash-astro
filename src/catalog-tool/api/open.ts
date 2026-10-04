// Opens the product's photo folder (or the catalog folder) in Finder.
import type { APIRoute } from 'astro';
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { CATALOG, PHOTOS } from '../lib/paths.mjs';
import { isPending, productExists, readProduct } from '../lib/catalog';
import { json, fail } from '../lib/http';

export const POST: APIRoute = ({ params }) => {
  try {
    const id = params.id!;
    const key = id === 'catalog' ? '' : productExists(id) ? readProduct(id).key : isPending(id) ? id : null;
    if (key === null) throw new Error('Unknown product');
    const dir = key ? path.join(PHOTOS, key) : CATALOG;
    fs.mkdirSync(dir, { recursive: true });
    execFile('open', [dir]);
    return json({ ok: true });
  } catch (e) {
    return fail(e);
  }
};
