// Reading and writing the local catalog: product files, the founder's notes, and photos.
import fs from 'node:fs';
import path from 'node:path';
import { PRODUCTS, PHOTOS, NOTES_FILE, IMAGE_EXT, slug } from './paths.mjs';
import { colourPhotos } from './photos.mjs';

export type Colour = { name: string; folder: string; sku: string };
export type ProductFile = {
  key: string;
  name?: string;
  title: string;
  handle: string;
  productType: string;
  category: string;
  tags: string[];
  seoTitle: string;
  seoDescription: { india: string; global: string };
  descriptionHtml: string;
  colours: Colour[];
  price: { india: string; global: string };
  stock: { india: number; global: number };
  grams: number;
  altBase?: string;
  custom: Record<string, string>;
  banner?: { desktop?: string; mobile?: string };
  shippingReturn: { india: string; global: string };
  google: Record<string, string>;
  categoryAttrs: Record<string, string[]>;
  writerNotes?: string;
  uploads?: Record<string, Record<string, { url: string; mtime: number }>>;
  pushed?: Record<string, { id: string; handle: string; at: string }>;
};

export const CATEGORY_OPTIONS = [
  { id: 'gid://shopify/TaxonomyCategory/aa-5-4-19', name: 'Shoulder bags' },
  { id: 'gid://shopify/TaxonomyCategory/aa-5-4-7', name: 'Crossbody bags' },
  { id: 'gid://shopify/TaxonomyCategory/aa-5-4-18', name: 'Tote (shopper) bags' },
  { id: 'gid://shopify/TaxonomyCategory/aa-5-4-4', name: 'Bucket bags' },
  { id: 'gid://shopify/TaxonomyCategory/aa-5-4-5', name: 'Clutch bags' },
  { id: 'gid://shopify/TaxonomyCategory/aa-5-4', name: 'Handbags (general, e.g. mini bags)' },
  { id: 'gid://shopify/TaxonomyCategory/aa-4-8', name: 'Bag charms' },
];

// The store-wide Shipping & Returns text every bag carries (live on Braidey, 4 Oct 2026).
const BAG_SHIPPING = {
  india: 'Free shipping across India. All prices include GST.\nOrders are delivered within 7–10 working days of purchase. If you need delivery earlier, please send us a message on WhatsApp.\n\nReturns are accepted within 7 days of delivery if the bag is unused, with its dust bag and Mir Kash box. Return shipping is paid by the customer: send it to our Mumbai office. Refunds of the item price are issued within 14 days of receiving the return. For more information, check the Returns page.',
  global: "Ships from Hong Kong by tracked express. Orders leave within 1–3 business days and arrive within 10 business days of shipping date, depending on your country. Shipping is free in Hong Kong and charged by region elsewhere, shown at checkout.\n\nDuties and import taxes are included in the price at checkout; however, if additional charges are imposed at the receiving country's customs, the customer is liable to pay them.\n\nReturns are accepted within 15 days of delivery if the bag is unused, with its dust bag and Mir Kash box. Return shipping is paid by the customer: send it to our Hong Kong office. Refunds of the item price are issued within 14 days of receiving the return.",
};

const titleCase = (s: string) => s.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
const fileOf = (id: string) => {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) throw new Error('Bad product id');
  return path.join(PRODUCTS, `${id}.json`);
};
const safeKey = (k: string) => {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(k)) throw new Error('Bad product key');
  return k;
};
const safeFolder = (f: string) => {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(f)) throw new Error('Bad colour folder');
  return f;
};

export function listProducts() {
  if (!fs.existsSync(PRODUCTS)) return [];
  return fs.readdirSync(PRODUCTS)
    .filter((f) => f.endsWith('.json') && !f.startsWith('_'))
    .map((f) => {
      const id = f.replace(/\.json$/, '');
      const P = readProduct(id);
      const photos = P.colours.reduce((n, c) => n + colourPhotos(P.key, c.folder).length, 0);
      return { id, title: P.title, name: P.name || P.title, colours: P.colours.map((c) => c.name), photos, pushed: P.pushed ?? {}, updated: fs.statSync(path.join(PRODUCTS, f)).mtimeMs };
    })
    .sort((a, b) => b.updated - a.updated);
}

export function readProduct(id: string): ProductFile {
  const file = fileOf(id);
  if (!fs.existsSync(file)) throw new Error(`No product file catalog/products/${id}.json`);
  const P = JSON.parse(fs.readFileSync(file, 'utf8')) as ProductFile;
  P.custom ??= {};
  P.categoryAttrs ??= {};
  P.banner ??= {};
  return P;
}

export function writeProduct(id: string, P: ProductFile) {
  fs.mkdirSync(PRODUCTS, { recursive: true });
  P.google = googleFields(P);
  fs.writeFileSync(fileOf(id), JSON.stringify(P, null, 1) + '\n');
}

function googleFields(P: ProductFile): Record<string, string> {
  const accessory = /TaxonomyCategory\/aa-4/.test(P.category);
  const occasion = P.tags.find((t) => t.startsWith('occasion-'))?.replace('occasion-', '') || 'everyday';
  return {
    google_product_category: accessory ? 'Apparel & Accessories > Handbag & Wallet Accessories' : 'Apparel & Accessories > Handbags, Wallets & Cases > Handbags',
    gender: 'female', age_group: 'adult', condition: 'new',
    custom_label_0: P.productType, custom_label_1: occasion, custom_product: 'true',
  };
}

/** A new product file. Colour folders already sitting in catalog/photos/<key>/ become its colours. */
export function createProduct(name: string): string {
  const key = slug(name);
  if (!key) throw new Error('Give the product a name');
  if (['photo', 'api', 'catalog'].includes(key)) throw new Error('Please choose a different name');
  if (fs.existsSync(fileOf(key))) throw new Error(`A product called "${name}" already exists`);
  const folders = fs.existsSync(path.join(PHOTOS, key))
    ? fs.readdirSync(path.join(PHOTOS, key), { withFileTypes: true }).filter((d) => d.isDirectory() && /^[a-z0-9]/.test(d.name) && !['story', 'banner'].includes(d.name)).map((d) => d.name)
    : [];
  const P: ProductFile = {
    key, name, title: name, handle: key, productType: '', category: CATEGORY_OPTIONS[5].id,
    tags: ['new', 'occasion-everyday'],
    seoTitle: '', seoDescription: { india: '', global: '' }, descriptionHtml: '',
    colours: folders.map((f) => ({ name: titleCase(f), folder: f, sku: `MK-${key}-${f}`.toUpperCase() })),
    price: { india: '', global: '' }, stock: { india: 100, global: 100 }, grams: 0,
    custom: { product_details: '', dimensions: '', care_guide: '', material_name: '', material_story: '', feature_cards: '[]', story_slides: '[]', faq: '[]', size_group: '', size_order: '' },
    banner: { desktop: '', mobile: '' },
    shippingReturn: { ...BAG_SHIPPING },
    google: {},
    categoryAttrs: {
      'target-gender': ['Female'], 'age-group': ['Adults'], 'bag-case-material': ['Faux leather'],
      'bag-case-features': ['Vegan-friendly'], 'bag-case-storage-features': ['Built-in compartments'],
    },
    writerNotes: '',
  };
  writeProduct(key, P);
  return key;
}

// ── Founder's notes: one **Name** section per product in Master-Product descriptions.md ──────────────
const HEADING = /^\*\*(.+?)\*\*\s*$/;
const plainName = (h: string) => h.replace(/\(done\)/i, '').replace(/[:*]/g, '').trim().toLowerCase();

function sections(text: string) {
  const lines = text.split('\n');
  const out: Array<{ name: string; start: number; end: number }> = [];
  lines.forEach((l, i) => {
    const m = l.match(HEADING);
    // Headings are short ("**Gigi (done)**"); a whole bold paragraph is notes, not a new section.
    if (m && m[1].length <= 60) { if (out.length) out[out.length - 1].end = i; out.push({ name: plainName(m[1]), start: i, end: lines.length }); }
  });
  return { lines, out };
}

export function readNotes(name: string): string {
  if (!fs.existsSync(NOTES_FILE)) return '';
  const { lines, out } = sections(fs.readFileSync(NOTES_FILE, 'utf8'));
  const s = out.find((x) => x.name === name.trim().toLowerCase());
  return s ? lines.slice(s.start + 1, s.end).join('\n').trim() : '';
}

export function writeNotes(name: string, body: string) {
  const text = fs.existsSync(NOTES_FILE) ? fs.readFileSync(NOTES_FILE, 'utf8') : '';
  const { lines, out } = sections(text);
  const s = out.find((x) => x.name === name.trim().toLowerCase());
  const clean = body.replace(/\r/g, '').trim();
  if (s) {
    if (lines.slice(s.start + 1, s.end).join('\n').trim() === clean) return;
    lines.splice(s.start + 1, s.end - s.start - 1, clean, '');
    fs.writeFileSync(NOTES_FILE, lines.join('\n'));
  } else if (clean) {
    fs.writeFileSync(NOTES_FILE, `${text.replace(/\s*$/, '')}\n\n**${name.trim()}**\n${clean}\n`);
  }
}

// ── Photos ────────────────────────────────────────────────────────────────────────────────────────
const productDir = (key: string) => path.join(PHOTOS, safeKey(key));

function moveAside(key: string, rel: string) {
  const from = path.join(productDir(key), rel);
  if (!fs.existsSync(from)) return;
  let to = path.join(productDir(key), '_removed', rel);
  if (fs.existsSync(to)) to = to.replace(/(\.[^.]+)$/, `-${Date.now()}$1`);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.renameSync(from, to);
}

/** Saves uploaded photos after the colour's last photo, numbered in the order they were picked. */
export async function addPhotos(key: string, folder: string, files: File[]) {
  const dir = path.join(productDir(key), safeFolder(folder));
  fs.mkdirSync(dir, { recursive: true });
  let n = colourPhotos(key, folder).reduce((max, p) => Math.max(max, parseInt(p.file, 10) || 0), 0);
  for (const f of files) {
    if (!IMAGE_EXT.test(f.name)) continue;
    const ext = path.extname(f.name).toLowerCase();
    n += 1;
    fs.writeFileSync(path.join(dir, `${String(n).padStart(2, '0')}${ext}`), Buffer.from(await f.arrayBuffer()));
  }
}

/**
 * Applies the order and labels set in the tool: files are renamed 01-label.ext, 02-label.ext… in that order.
 * Photos the tool removed go to catalog/photos/<key>/_removed/ (never deleted). Photos it didn't know about
 * (e.g. dropped in from Finder while the page was open) are kept, after the others.
 */
export function arrangePhotos(key: string, folder: string, order: Array<{ file: string; label: string }>, removed: string[]) {
  const dir = path.join(productDir(key), safeFolder(folder));
  if (!fs.existsSync(dir)) return;
  for (const f of removed) if (path.basename(f) === f) moveAside(key, path.join(folder, f));
  const present = colourPhotos(key, folder);
  const known = order.filter((o) => present.some((p) => p.file === o.file));
  const rest = present.filter((p) => !known.some((o) => o.file === p.file)).map((p) => ({ file: p.file, label: p.label }));
  const all = [...known, ...rest];
  const target = all.map((o, i) => `${String(i + 1).padStart(2, '0')}${slug(o.label) ? `-${slug(o.label)}` : ''}${path.extname(o.file).toLowerCase()}`);
  if (all.every((o, i) => o.file === target[i])) return;
  const tmp = all.map((o, i) => { const t = `.tmp-${i}-${o.file}`; fs.renameSync(path.join(dir, o.file), path.join(dir, t)); return t; });
  tmp.forEach((t, i) => fs.renameSync(path.join(dir, t), path.join(dir, target[i])));
}

/** A colour was renamed: its folder follows, unless that name is already taken. Returns the folder in use. */
export function renameColourFolder(key: string, from: string, to: string): string {
  if (!to || from === to) return from || to;
  const base = productDir(key);
  if (!from || !fs.existsSync(path.join(base, from))) return to;
  if (fs.existsSync(path.join(base, to))) return from;
  fs.renameSync(path.join(base, safeFolder(from)), path.join(base, safeFolder(to)));
  return to;
}

/** Story close-ups and banners: catalog/photos/<key>/story/… and …/banner/…. Returns the path to store. */
export async function addAsset(key: string, kind: 'story' | 'banner', file: File): Promise<string> {
  if (!IMAGE_EXT.test(file.name)) throw new Error('That file is not an image');
  const dir = path.join(productDir(key), kind);
  fs.mkdirSync(dir, { recursive: true });
  const name = `${kind === 'story' ? 'slide' : 'banner'}-${Date.now()}${path.extname(file.name).toLowerCase()}`;
  fs.writeFileSync(path.join(dir, name), Buffer.from(await file.arrayBuffer()));
  return `${kind}/${name}`;
}

/** Story and banner images no longer used by the product are moved to _removed. */
export function tidyAssets(P: ProductFile) {
  const used = new Set<string>([P.banner?.desktop ?? '', P.banner?.mobile ?? '']);
  try { for (const s of JSON.parse(P.custom.story_slides || '[]')) used.add(s.image ?? ''); } catch { /* ignore */ }
  for (const kind of ['story', 'banner']) {
    const dir = path.join(productDir(P.key), kind);
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) if (!f.startsWith('.') && !used.has(`${kind}/${f}`)) moveAside(P.key, `${kind}/${f}`);
  }
}

export function photoUrl(key: string, rel: string, width?: number) {
  return `/catalog-tool/photo/${key}/${rel.split('/').map(encodeURIComponent).join('/')}${width ? `?w=${width}` : ''}`;
}
