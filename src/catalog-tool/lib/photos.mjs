// Product photos live in catalog/photos/<product key>/<colour folder>/NN-label.ext.
// NN is the gallery position (01 = main photo); the label becomes the alt text.
import fs from 'node:fs';
import path from 'node:path';
import { PHOTOS, IMAGE_EXT } from './paths.mjs';

export const labelOf = (file) => file.replace(/\.[^.]+$/, '').replace(/^\d+[-_ ]?/, '').replace(/[-_]+/g, ' ').trim();

export function colourPhotos(key, folder) {
  const dir = path.join(PHOTOS, key, folder);
  if (!folder || !fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => !f.startsWith('.') && IMAGE_EXT.test(f))
    .sort()
    .map((file) => ({ file, label: labelOf(file), path: path.join(dir, file), mtime: fs.statSync(path.join(dir, file)).mtimeMs }));
}

export const altFor = (P, colourName, label) => `${P.altBase || P.title} in ${colourName}${label ? `, ${label}` : ''}`;
