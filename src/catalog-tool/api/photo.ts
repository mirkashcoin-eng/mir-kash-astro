// Serves catalog/photos files to the tool and its preview. ?w=360 gives a resized copy (cached in memory).
import type { APIRoute } from 'astro';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { PHOTOS } from '../lib/paths.mjs';

const TYPES: Record<string, string> = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.avif': 'image/avif' };
const cache = new Map<string, Buffer>();

export const GET: APIRoute = async ({ params, url }) => {
  let rel = params.path ?? '';
  try { rel = decodeURIComponent(rel); } catch { /* already decoded */ }
  const file = path.resolve(PHOTOS, rel);
  if (!file.startsWith(PHOTOS + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return new Response('Not found', { status: 404 });
  const ext = path.extname(file).toLowerCase();
  const w = Math.min(Number(url.searchParams.get('w')) || 0, 2400);
  if (!w && TYPES[ext]) return new Response(fs.readFileSync(file), { headers: { 'Content-Type': TYPES[ext], 'Cache-Control': 'no-cache' } });
  const key = `${file}:${fs.statSync(file).mtimeMs}:${w}`;
  if (!cache.has(key)) {
    if (cache.size > 400) cache.clear();
    cache.set(key, await sharp(file).rotate().resize({ width: w || 2400, height: w ? undefined : 2400, fit: 'inside', withoutEnlargement: true }).webp({ quality: 82 }).toBuffer());
  }
  return new Response(cache.get(key), { headers: { 'Content-Type': 'image/webp', 'Cache-Control': 'no-cache' } });
};
