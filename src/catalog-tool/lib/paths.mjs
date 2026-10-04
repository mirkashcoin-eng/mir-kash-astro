// Where the catalog lives. The tool always runs from the website folder (the launcher cd's there first).
import path from 'node:path';

export const ROOT = process.cwd();
export const CATALOG = path.join(ROOT, 'catalog');
export const PRODUCTS = path.join(CATALOG, 'products');
export const PHOTOS = path.join(CATALOG, 'photos');
export const NOTES_FILE = path.join(CATALOG, 'Master-Product descriptions.md');
export const STRUCTURE_FILE = path.join(CATALOG, 'PRODUCT-PAGE-STRUCTURE.md');

export const slug = (s) => String(s ?? '').toLowerCase().replace(/&/g, ' ').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
export const IMAGE_EXT = /\.(png|jpe?g|webp|avif|tiff?)$/i;
