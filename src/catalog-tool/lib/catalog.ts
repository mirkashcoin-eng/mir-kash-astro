// Reading and writing the local catalog: product files, the founder's notes, and photos.
import fs from 'node:fs';
import path from 'node:path';
import { PRODUCTS, PHOTOS, NOTES_FILE, IMAGE_EXT, slug } from './paths.mjs';
import { colourPhotos } from './photos.mjs';
import { googleFields } from './google.mjs';

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
export const BAG_SHIPPING = {
  india: 'Free shipping across India. All prices include GST.\nOrders are delivered within 7–10 working days of purchase. If you need delivery earlier, please send us a message on WhatsApp.\n\nReturns are accepted within 7 days of delivery if the bag is unused, with its dust bag and Mir Kash box. Return shipping is paid by the customer: send it to our Mumbai office. Refunds of the item price are issued within 14 days of receiving the return. For more information, check the Returns page.',
  global: "Ships from Hong Kong by tracked express. Orders leave within 1–3 business days and arrive within 10 business days of shipping date, depending on your country. Shipping is free in Hong Kong and charged by region elsewhere, shown at checkout.\n\nDuties and import taxes are included in the price at checkout; however, if additional charges are imposed at the receiving country's customs, the customer is liable to pay them.\n\nReturns are accepted within 15 days of delivery if the bag is unused, with its dust bag and Mir Kash box. Return shipping is paid by the customer: send it to our Hong Kong office. Refunds of the item price are issued within 14 days of receiving the return.",
};

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

const pendingOf = (id: string) => fileOf(id).replace(/\.json$/, '.pending.json');
const JSON_FIELDS = ['feature_cards', 'story_slides', 'faq'];

export type Listed = { id: string; title: string; colours: string[]; photos: number; pushed: Record<string, { at: string }>; updated: number; waiting: boolean; broken?: string };

export function listProducts(): Listed[] {
  if (!fs.existsSync(PRODUCTS)) return [];
  const out: Listed[] = [];
  for (const f of fs.readdirSync(PRODUCTS)) {
    if (f.startsWith('_') || f.startsWith('.') || !f.endsWith('.json')) continue;
    const updated = fs.statSync(path.join(PRODUCTS, f)).mtimeMs;
    if (f.endsWith('.pending.json')) {
      const id = f.replace(/\.pending\.json$/, '');
      if (fs.existsSync(fileOf(id))) continue;
      out.push({ id, title: readPending(id).name, colours: [], photos: inboxPhotos(id).length, pushed: {}, updated, waiting: true });
      continue;
    }
    const id = f.replace(/\.json$/, '');
    try {
      const P = readProduct(id);
      const photos = P.colours.reduce((n, c) => n + colourPhotos(P.key, c.folder).length, 0);
      out.push({ id, title: P.title, colours: P.colours.map((c) => c.name), photos, pushed: P.pushed ?? {}, updated, waiting: false });
    } catch (e) {
      out.push({ id, title: id, colours: [], photos: 0, pushed: {}, updated, waiting: true, broken: e instanceof Error ? e.message : String(e) });
    }
  }
  return out.sort((a, b) => b.updated - a.updated);
}

export const productExists = (id: string) => fs.existsSync(fileOf(id));
export const productStamp = (id: string) => (fs.existsSync(fileOf(id)) ? Math.round(fs.statSync(fileOf(id)).mtimeMs) : 0);

/** Fills in anything missing, and accepts arrays where the file format wants JSON text, so a hand- or Claude-written file always opens. */
function normalise(P: ProductFile): ProductFile {
  P.name ||= P.title;
  P.title ||= P.name || '';
  P.handle ||= slug(P.title);
  P.productType ??= '';
  P.category ||= CATEGORY_OPTIONS[5].id;
  P.tags = Array.isArray(P.tags) ? P.tags.map(String) : [];
  P.seoTitle ??= '';
  P.seoDescription = { india: '', global: '', ...(P.seoDescription ?? {}) };
  P.descriptionHtml ??= '';
  P.colours = (Array.isArray(P.colours) ? P.colours : []).map((c) => ({ name: String(c.name ?? ''), folder: c.folder || slug(c.name), sku: c.sku || `MK-${P.key}-${slug(c.name)}`.toUpperCase() }));
  P.price = { india: '', global: '', ...(P.price ?? {}) };
  P.stock = { india: 0, global: 0, ...(P.stock ?? {}) };
  P.grams = Number(P.grams) || 0;
  P.custom ??= {};
  for (const [k, v] of Object.entries(P.custom)) {
    if (JSON_FIELDS.includes(k) && typeof v !== 'string') P.custom[k] = JSON.stringify(v ?? []);
    else if (Array.isArray(v)) P.custom[k] = v.map((l) => `• ${String(l).replace(/^[•\s]+/, '')}`).join('\n');
    else if (typeof v !== 'string') P.custom[k] = v == null ? '' : String(v);
  }
  P.categoryAttrs ??= {};
  P.banner ??= {};
  P.shippingReturn = { ...BAG_SHIPPING, ...(P.shippingReturn ?? {}) };
  P.google ??= {};
  return P;
}

export function readProduct(id: string): ProductFile {
  const file = fileOf(id);
  if (!fs.existsSync(file)) throw new Error(`No product file catalog/products/${id}.json`);
  let P: ProductFile;
  try { P = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) {
    throw new Error(`catalog/products/${id}.json isn't valid JSON (${e instanceof Error ? e.message : e})`);
  }
  P.key ||= id;
  return normalise(P);
}

export function writeProduct(id: string, P: ProductFile) {
  fs.mkdirSync(PRODUCTS, { recursive: true });
  P.google = googleFields(P);
  fs.writeFileSync(fileOf(id), JSON.stringify(P, null, 1) + '\n');
  if (fs.existsSync(pendingOf(id))) fs.rmSync(pendingOf(id));
}

// ── A new product waits for Claude Code: name + notes saved, photos in catalog/photos/<key>/, no product file yet ──
export function readPending(id: string): { name: string; created: string } {
  return JSON.parse(fs.readFileSync(pendingOf(id), 'utf8'));
}
export const isPending = (id: string) => fs.existsSync(pendingOf(id)) && !fs.existsSync(fileOf(id));

export function createPending(name: string, notes: string): string {
  name = name.trim();
  const key = slug(name);
  if (!key) throw new Error('Give the product a name');
  if (['photo', 'api', 'catalog', 'new'].includes(key)) throw new Error('Please choose a different name');
  if (fs.existsSync(fileOf(key))) throw new Error(`There is already a product called "${name}"`);
  if (!notes.trim()) throw new Error('Add your notes about the product');
  fs.mkdirSync(PRODUCTS, { recursive: true });
  fs.writeFileSync(pendingOf(key), JSON.stringify({ name, created: new Date().toISOString() }, null, 1) + '\n');
  writeNotes(name, notes);
  return key;
}

/** Photos dropped in for Claude Code to sort: loose files in catalog/photos/<key>/ and its _unsorted/ folder. */
export function inboxPhotos(key: string): string[] {
  const out: string[] = [];
  for (const sub of ['', '_unsorted']) {
    const dir = path.join(PHOTOS, safeKey(key), sub);
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) {
      if (!f.startsWith('.') && IMAGE_EXT.test(f) && fs.statSync(path.join(dir, f)).isFile()) out.push(sub ? `${sub}/${f}` : f);
    }
  }
  return out.sort();
}

export async function addInboxPhotos(key: string, files: File[]) {
  const dir = path.join(PHOTOS, safeKey(key));
  fs.mkdirSync(dir, { recursive: true });
  for (const f of files) {
    if (!IMAGE_EXT.test(f.name)) continue;
    const base = path.basename(f.name).replace(/[^\w.\- ]+/g, '_');
    let name = base;
    for (let n = 2; fs.existsSync(path.join(dir, name)); n++) name = base.replace(/(\.[^.]+)$/, `-${n}$1`);
    fs.writeFileSync(path.join(dir, name), Buffer.from(await f.arrayBuffer()));
  }
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
