import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

const SRC = 'C:/Users/RAHUL/OneDrive/Desktop/Model';
const DEST = 'C:/Users/RAHUL/OneDrive/Desktop/mir-kash-astro/public';

const MAP = [
  { src: 'image-1.jpg',                                                        out: 'banner.webp',       width: 2400 },
  { src: '8e44b4be-3374-46a9-8467-1bb7973e4fb4.jpg',                           out: 'ed-swim.webp',      width: 1200 },
  { src: 'hf_20260516_103107_d031b4b3-5a81-41bc-87ba-dfdc415ce663.jpg',        out: 'ed-arrivals.webp',  width: 1200 },
  { src: 'hf_20260525_125323_b327b52f-288d-4a2e-a71a-07d6345463f4.jpg',        out: 'ed-dresses.webp',   width: 1200 },
  { src: 'hf_20260525_100812_4a9a0dc5-850e-488d-985e-6853190132b9.jpg',        out: 'ed-jewelry.webp',   width: 1200 },
];

await mkdir(DEST, { recursive: true });

for (const { src, out, width } of MAP) {
  const inPath = path.join(SRC, src);
  const outPath = path.join(DEST, out);
  const info = await sharp(inPath)
    .resize({ width, withoutEnlargement: true })
    .webp({ quality: 82 })
    .toFile(outPath);
  console.log(`${out}: ${(info.size / 1024).toFixed(1)} KB (${info.width}x${info.height})`);
}
