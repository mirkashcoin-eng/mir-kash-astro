// Creates or updates one product in one Shopify store from its catalog/products/<id>.json file.
// Used by the catalog tool's Push button and by catalog/scripts/push_product.mjs.
// Order matters: photos → product (all fields, variants, stock on create) → publish to every channel AND every
// market catalog (India's market catalog lists products by name; skipping it hid the whole India catalog once)
// → category attributes last (productSet clears them).
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { admin } from './admin.mjs';
import { PHOTOS, slug } from './paths.mjs';
import { colourPhotos, altFor } from './photos.mjs';

const TYPES = {
  product_details: 'multi_line_text_field', dimensions: 'single_line_text_field', care_guide: 'multi_line_text_field',
  material_name: 'single_line_text_field', material_story: 'multi_line_text_field', feature_cards: 'multi_line_text_field',
  story_slides: 'multi_line_text_field', faq: 'multi_line_text_field', size_group: 'single_line_text_field',
  size_order: 'number_integer', shipping_return: 'multi_line_text_field', warranty: 'single_line_text_field',
  fullbleed_image: 'single_line_text_field', fullbleed_image_mobile: 'single_line_text_field',
};
const isUrl = (v) => /^https:\/\//.test(v ?? '');

async function toJpeg(file, maxSide) {
  return sharp(file).rotate().resize({ width: maxSide, height: maxSide, fit: 'inside', withoutEnlargement: true })
    .flatten({ background: '#ffffff' }).jpeg({ quality: 88, progressive: true }).toBuffer();
}

async function stage(store, filename, buf) {
  const t = (await admin(store, `mutation($i:[StagedUploadInput!]!){ stagedUploadsCreate(input:$i){ stagedTargets{ url resourceUrl parameters{ name value } } userErrors{ message } } }`,
    { i: [{ filename, mimeType: 'image/jpeg', resource: 'IMAGE', httpMethod: 'POST', fileSize: String(buf.length) }] })).stagedUploadsCreate;
  if (t.userErrors.length) throw new Error(`upload ${filename}: ${JSON.stringify(t.userErrors)}`);
  const target = t.stagedTargets[0];
  const form = new FormData();
  for (const { name, value } of target.parameters) form.append(name, value);
  form.append('file', new Blob([buf], { type: 'image/jpeg' }), filename);
  const r = await fetch(target.url, { method: 'POST', body: form });
  if (!r.ok) throw new Error(`upload ${filename}: HTTP ${r.status}`);
  return target.resourceUrl;
}

// Story close-ups and banners go to the store's Files and are referenced by their https address.
async function uploadFile(store, P, rel, alt, log) {
  const file = path.join(PHOTOS, P.key, rel);
  if (!fs.existsSync(file)) throw new Error(`Missing image ${rel} in catalog/photos/${P.key}`);
  const mtime = fs.statSync(file).mtimeMs;
  const cached = P.uploads?.[store]?.[rel];
  if (cached?.url && cached.mtime === mtime) return cached.url;
  const name = `${P.key}-${rel.replace(/[\/\\]/g, '-').replace(/\.[^.]+$/, '')}.jpg`;
  const src = await stage(store, name, await toJpeg(file, 2520));
  const fc = (await admin(store, `mutation($f:[FileCreateInput!]!){ fileCreate(files:$f){ files{ id } userErrors{ message } } }`,
    { f: [{ originalSource: src, contentType: 'IMAGE', alt }] })).fileCreate;
  if (fc.userErrors.length) throw new Error(`${rel}: ${JSON.stringify(fc.userErrors)}`);
  const id = fc.files[0].id;
  for (let i = 0; i < 40; i++) {
    const n = (await admin(store, `query($id:ID!){ node(id:$id){ ... on MediaImage { fileStatus image{ url } } } }`, { id })).node;
    if (n?.image?.url) {
      P.uploads ??= {}; P.uploads[store] ??= {};
      P.uploads[store][rel] = { url: n.image.url, mtime };
      log(`  ✓ ${rel} uploaded to Files`);
      return n.image.url;
    }
    if (n?.fileStatus === 'FAILED') throw new Error(`Shopify could not process ${rel}`);
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error(`${rel}: Shopify took too long to process the image`);
}

async function existingProduct(store, P) {
  const id = P.pushed?.[store]?.id;
  if (id) {
    const p = (await admin(store, `query($id:ID!){ product(id:$id){ id status handle } }`, { id })).product;
    if (p) return p;
  }
  return (await admin(store, `query($h:String!){ productByHandle(handle:$h){ id status handle } }`, { h: P.handle })).productByHandle;
}

/**
 * Push one product to one store. Returns the updated product file contents (upload cache + push record), which the
 * caller saves. `log` receives one human-readable line per step.
 */
export async function pushProduct(P, store, { log = console.log, dryRun = false, status = 'ACTIVE' } = {}) {
  if (!['india', 'global'].includes(store)) throw new Error(`Unknown store ${store}`);
  P = structuredClone(P);
  const storeName = store === 'india' ? 'India' : 'Global';

  // 1. Photos, colour by colour, in file order.
  const photos = [];
  for (const c of P.colours) {
    const list = colourPhotos(P.key, c.folder);
    if (!list.length) throw new Error(`${c.name} has no photos (catalog/photos/${P.key}/${c.folder})`);
    for (const p of list) photos.push({ colour: c.name, src: p.path, name: `${P.key}-${c.folder}-${p.file.slice(0, 2)}.jpg`, alt: altFor(P, c.name, p.label) });
  }
  const ex = await existingProduct(store, P);
  log(`${storeName}: ${P.title} — ${ex ? `already in the store (${ex.status.toLowerCase()}), updating it` : 'new, creating it'} · ${P.colours.length} colour(s) · ${photos.length} photos`);
  if (dryRun) { photos.forEach((p) => log(`    ${p.name} · ${p.alt}`)); return P; }

  for (const [i, p] of photos.entries()) {
    p.url = await stage(store, p.name, await toJpeg(p.src, 2500));
    if ((i + 1) % 5 === 0 || i === photos.length - 1) log(`  ✓ photos uploaded: ${i + 1} of ${photos.length}`);
  }

  // 2. Story close-ups and banners: local files become Shopify Files addresses.
  const custom = { ...P.custom };
  delete custom.tagline;
  const slides = (() => { try { return JSON.parse(custom.story_slides || '[]'); } catch { return []; } })();
  for (const s of slides) {
    if (s.image && !isUrl(s.image)) s.image = await uploadFile(store, P, s.image, `${P.title}: ${s.title}`, log);
    else s.image ??= '';
  }
  if (slides.length) custom.story_slides = JSON.stringify(slides);
  for (const [k, rel] of [['fullbleed_image', P.banner?.desktop], ['fullbleed_image_mobile', P.banner?.mobile]]) {
    custom[k] = rel ? (isUrl(rel) ? rel : await uploadFile(store, P, rel, P.title, log)) : '';
  }
  custom.shipping_return = P.shippingReturn?.[store] ?? '';

  // 3. The product itself.
  const locs = (await admin(store, `{ locations(first: 20) { nodes { id name } } }`)).locations.nodes;
  const loc = (store === 'india' ? locs.find((l) => l.id.endsWith('/80200532183')) : locs.find((l) => /PARC PALAIS/i.test(l.name))) ?? locs[0];
  const filled = Object.entries(custom).filter(([k, v]) => TYPES[k] && String(v ?? '').trim() !== '');
  const empty = Object.keys(TYPES).filter((k) => !filled.some(([f]) => f === k) && k !== 'warranty');
  const metafields = filled.map(([key, value]) => ({ namespace: 'custom', key, type: TYPES[key], value: String(value) }));
  for (const [key, value] of Object.entries(P.google ?? {})) {
    if (String(value ?? '') !== '') metafields.push({ namespace: 'mm-google-shopping', key, type: key === 'custom_product' ? 'boolean' : 'single_line_text_field', value: String(value) });
  }
  const input = {
    ...(ex ? { id: ex.id } : {}),
    title: P.title, handle: P.handle, descriptionHtml: P.descriptionHtml, vendor: 'Mir Kash', productType: P.productType,
    tags: P.tags, status, category: P.category, seo: { title: P.seoTitle, description: P.seoDescription?.[store] ?? '' },
    productOptions: [{ name: 'Color', position: 1, values: P.colours.map((c) => ({ name: c.name })) }],
    files: photos.map((p) => ({ originalSource: p.url, alt: p.alt, contentType: 'IMAGE' })),
    variants: P.colours.map((c) => {
      const hero = photos.find((p) => p.colour === c.name);
      return {
        optionValues: [{ optionName: 'Color', name: c.name }], sku: c.sku, price: String(P.price[store]), taxable: true, inventoryPolicy: 'DENY',
        inventoryItem: { tracked: true, requiresShipping: true, measurement: { weight: { value: Number(P.grams) || 0, unit: 'GRAMS' } } },
        ...(ex ? {} : { inventoryQuantities: [{ locationId: loc.id, name: 'available', quantity: Number(P.stock[store]) || 0 }] }),
        metafields: [{ namespace: 'mm-google-shopping', key: 'mpn', type: 'single_line_text_field', value: c.sku }],
        file: { originalSource: hero.url, alt: hero.alt, contentType: 'IMAGE' },
      };
    }),
    metafields,
  };
  const ps = (await admin(store, `mutation($input: ProductSetInput!){ productSet(input: $input, synchronous: true){ product{ id handle status totalInventory } userErrors{ field message } } }`, { input })).productSet;
  if (ps.userErrors.length) throw new Error(`Shopify refused the product: ${ps.userErrors.map((e) => `${(e.field ?? []).join('.')} ${e.message}`).join('; ')}`);
  const pid = ps.product.id;
  log(`  ✓ product ${ex ? 'updated' : 'created'} (${ps.product.status.toLowerCase()}), stock ${ps.product.totalInventory}${ex ? ' (unchanged on updates)' : ''} at ${loc.name}`);

  // Fields emptied in the tool are removed in Shopify too, so the page doesn't keep showing old text.
  if (ex && empty.length) {
    try {
      await admin(store, `mutation($m:[MetafieldIdentifierInput!]!){ metafieldsDelete(metafields:$m){ userErrors{ message } } }`,
        { m: empty.map((key) => ({ ownerId: pid, namespace: 'custom', key })) });
    } catch (e) { log(`  ! could not clear empty fields: ${e.message}`); }
  }

  // 4. Every sales channel + every market catalog.
  if (status === 'ACTIVE') {
    const pubs = (await admin(store, `{ publications(first: 50) { nodes { id } } }`)).publications.nodes.map((p) => p.id);
    const mkt = (await admin(store, `{ catalogs(first: 50, type: MARKET) { nodes { publication { id } } } }`)).catalogs.nodes.map((c) => c.publication?.id).filter(Boolean);
    const pub = (await admin(store, `mutation($id:ID!,$in:[PublicationInput!]!){ publishablePublish(id:$id, input:$in){ userErrors{ message } } }`,
      { id: pid, in: [...new Set([...pubs, ...mkt])].map((publicationId) => ({ publicationId })) })).publishablePublish;
    log(`  ✓ published to ${pubs.length} sales channels and ${mkt.length} market catalog(s)${pub.userErrors.length ? ` — note: ${pub.userErrors.map((e) => e.message).join('; ')}` : ''}`);
  }

  // 5. Category attributes (Shopify metaobject entries), last. One call per attribute: metafieldsSet is all-or-nothing
  // across its input, so one attribute the category doesn't really support would otherwise undo all the others.
  const attrs = Object.entries(P.categoryAttrs ?? {}).filter(([, v]) => v?.length);
  if (attrs.length && P.category) {
    const cat = (await admin(store, `query($id:ID!){ node(id:$id){ ... on TaxonomyCategory { attributes(first: 60) { nodes { ... on TaxonomyChoiceListAttribute { name values(first: 250) { nodes { id name } } } } } } } }`, { id: P.category })).node;
    const keyOf = (name) => (slug(name) === 'color' ? 'color-pattern' : slug(name));
    const ok = [], failed = [];
    for (const [key, names] of attrs) {
      const attr = cat?.attributes.nodes.find((a) => a.name && keyOf(a.name) === key);
      const ids = [];
      for (const name of names) {
        const type = `shopify--${key}`, handle = slug(name);
        let mo = (await admin(store, `query($h:MetaobjectHandleInput!){ metaobjectByHandle(handle:$h){ id } }`, { h: { type, handle } })).metaobjectByHandle;
        const val = attr?.values.nodes.find((v) => v.name.toLowerCase() === name.toLowerCase());
        if (!mo && val && key !== 'color-pattern') {
          mo = (await admin(store, `mutation($m:MetaobjectCreateInput!){ metaobjectCreate(metaobject:$m){ metaobject{ id } userErrors{ message } } }`,
            { m: { type, handle, fields: [{ key: 'label', value: name }, { key: 'taxonomy_reference', value: val.id }] } })).metaobjectCreate.metaobject;
        }
        if (mo) ids.push(mo.id); else failed.push([`${key}: ${name}`, 'no matching Shopify value']);
      }
      if (!ids.length) continue;
      const ms = (await admin(store, `mutation($m:[MetafieldsSetInput!]!){ metafieldsSet(metafields:$m){ userErrors{ message } } }`,
        { m: [{ ownerId: pid, namespace: 'shopify', key, type: 'list.metaobject_reference', value: JSON.stringify(ids) }] })).metafieldsSet;
      if (ms.userErrors.length) failed.push([key, ms.userErrors.map((e) => e.message).join('; ')]); else ok.push(key);
    }
    if (ok.length) log(`  ✓ category attributes: ${ok.join(', ')}`);
    for (const [k, why] of failed) log(`  ! skipped attribute ${k} (${why})`);
  }

  P.pushed ??= {};
  P.pushed[store] = { id: pid, handle: ps.product.handle, at: new Date().toISOString() };
  log(`  ✓ done: https://www.mirkash.com${store === 'india' ? '' : '/en-us'}/products/${ps.product.handle}`);
  return P;
}
