// Builds the Shopify customer notification emails for both stores.
//
//   node scripts/build-shopify-emails.mjs
//
// Shopify notifications can't include snippets and are edited by hand in each store's
// admin (Settings → Notifications), so the source lives in shopify-emails/src and this
// script assembles one self-contained file per notification per store:
//
//   shopify-emails/dist/<store>/<template>.liquid   paste into that store's template
//   shopify-emails/dist/<store>/SUBJECTS.md         the subject line for each
//   shopify-emails/preview/…                        rendered with sample data (liquidjs)
//
// Assembly rules:
//   - a template is frontmatter, a prelude (captures/assigns), a `<!-- body -->` line, then the body
//   - %%BODY%% in layout.liquid takes the body; the prelude goes above the layout so
//     email_title etc. exist before <title> is rendered
//   - {% render 'name' %} is inlined from src/partials at build time (recursively)
//   - %%token%% is replaced with an inline style from STYLES below
//   - each store gets a prelude of mk_* constants (STORES below), so one source serves both
import { readFile, writeFile, readdir, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { Liquid } from 'liquidjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', 'shopify-emails');
const SRC = path.join(ROOT, 'src');
const DIST = path.join(ROOT, 'dist');
const PREVIEW = path.join(ROOT, 'preview');

// ── Brand tokens (brand-wiki/brand-guidelines.md §6) ──────────────────────────
const C = {
  cherry: '#8B1A1A',
  beige: '#D9C7A8',
  forest: '#3D6B4F',
  fig: '#2C1A0E',
  parchment: '#FAF7F2',
  muted: '#6B5A4C',   // Deep Fig softened for secondary text; 6:1 on Parchment
  hair: '#E8DDCB',    // Beige tint for row dividers
  wash: '#F2EADD',    // Beige tint for callout panels
};
const SERIF = "font-family:'DM Serif Display',Georgia,'Times New Roman',serif;font-weight:400;";
const SANS = "font-family:Brooklyn,'Helvetica Neue',Helvetica,Arial,sans-serif;";

const STYLES = {
  h1: `${SERIF}font-size:32px;line-height:38px;color:${C.fig};margin:0;`,
  h2: `${SERIF}font-size:21px;line-height:27px;color:${C.fig};margin:0 0 4px;`,
  p: `${SANS}font-size:15px;line-height:24px;color:${C.fig};margin:0 0 16px;`,
  'p-last': `${SANS}font-size:15px;line-height:24px;color:${C.fig};margin:0;`,
  small: `${SANS}font-size:13px;line-height:20px;color:${C.muted};margin:0;`,
  label: `${SANS}font-size:11px;line-height:16px;letter-spacing:0.14em;text-transform:uppercase;font-weight:600;color:${C.forest};margin:0 0 10px;`,
  link: `color:${C.cherry};text-decoration:underline;`,
  'item-title': `${SERIF}font-size:17px;line-height:22px;color:${C.fig};margin:0 0 4px;`,
  'item-meta': `${SANS}font-size:13px;line-height:20px;color:${C.muted};margin:0;`,
  'item-note': `${SANS}font-size:12px;line-height:18px;color:${C.forest};margin:4px 0 0;`,
  'item-img-cell': `width:72px;padding:18px 16px 18px 0;border-bottom:1px solid ${C.hair};vertical-align:top;`,
  'item-text-cell': `padding:18px 0;border-bottom:1px solid ${C.hair};vertical-align:top;`,
  'item-price-cell': `${SANS}font-size:14px;line-height:22px;color:${C.fig};padding:18px 0 18px 12px;border-bottom:1px solid ${C.hair};vertical-align:top;text-align:right;white-space:nowrap;`,
  'item-img': `display:block;width:72px;height:auto;border:0;background-color:${C.wash};`,
  strike: `color:${C.muted};text-decoration:line-through;font-size:13px;`,
  'total-label': `${SANS}font-size:14px;line-height:22px;color:${C.muted};padding:5px 0;`,
  'total-value': `${SANS}font-size:14px;line-height:22px;color:${C.fig};padding:5px 0;text-align:right;white-space:nowrap;`,
  'grand-label': `${SERIF}font-size:19px;line-height:26px;color:${C.fig};padding:14px 0 0;border-top:1px solid ${C.beige};`,
  'grand-value': `${SERIF}font-size:19px;line-height:26px;color:${C.fig};padding:14px 0 0;border-top:1px solid ${C.beige};text-align:right;white-space:nowrap;`,
  'grand-note': `${SANS}font-size:13px;line-height:20px;color:${C.forest};padding:6px 0 0;text-align:right;`,
  section: `padding:36px 0 0;`,
  rule: `border-top:1px solid ${C.beige};font-size:0;line-height:0;`,
  callout: `background-color:${C.wash};border-left:3px solid ${C.forest};padding:18px 20px;`,
  'callout-alert': `background-color:${C.wash};border-left:3px solid ${C.cherry};padding:18px 20px;`,
  code: `${SERIF}font-size:26px;line-height:32px;letter-spacing:0.08em;color:${C.fig};background-color:${C.wash};border:1px dashed ${C.beige};padding:18px 20px;text-align:center;`,
  'addr-cell': `${SANS}font-size:14px;line-height:22px;color:${C.fig};vertical-align:top;padding:0 16px 20px 0;`,
  'foot-p': `${SANS}font-size:13px;line-height:21px;color:${C.beige};margin:0 0 6px;`,
  'foot-link': `color:${C.parchment};text-decoration:underline;`,
  'foot-line': `${SERIF}font-size:22px;line-height:28px;color:${C.parchment};margin:22px 0 20px;`,
  'btn-cell': `background-color:${C.cherry};`,
  'btn-a': `${SANS}display:inline-block;padding:16px 34px;font-size:13px;line-height:18px;font-weight:600;letter-spacing:0.12em;text-transform:uppercase;color:${C.parchment};text-decoration:none;`,
  'btn-ghost-a': `${SANS}display:inline-block;padding:15px 33px;font-size:13px;line-height:18px;font-weight:600;letter-spacing:0.12em;text-transform:uppercase;color:${C.cherry};text-decoration:none;border:1px solid ${C.cherry};`,
};

// ── Per-store constants (brand-wiki/SHIPPING-RETURNS-POLICY.md) ───────────────
// The site is one host for both stores: India at the root, Global under /en-xx. Root
// links are geo/cookie-redirected to the visitor's market (src/middleware.ts), so the
// same URLs work in both stores' emails.
const SITE = 'https://www.mirkash.com';
const STORES = {
  india: {
    mk_store: 'india',
    mk_site: SITE,
    mk_assets: `${SITE}/email`,
    mk_help_email: 'order@mirkash.com',
    mk_returns_email: 'returns@mirkash.com',
    mk_return_days: '7',
    mk_return_address: 'Jaywant Industrial Estate, Tardeo, Mumbai 400034, India',
    mk_delivery_promise: 'It should reach you within 7–10 working days.',
    mk_taxes_label: 'GST (included)',
  },
  global: {
    mk_store: 'global',
    mk_site: SITE,
    mk_assets: `${SITE}/email`,
    mk_help_email: 'order@mirkash.com',
    mk_returns_email: 'returns@mirkash.com',
    mk_return_days: '15',
    mk_return_address: 'Guardforce Centre, 03 Hok Yuen Street, Hung Hom, Hong Kong',
    mk_delivery_promise: 'It leaves our Hong Kong office within 1–3 business days by tracked express.',
    mk_taxes_label: 'Taxes (included)',
  },
};

// ── Assembly ──────────────────────────────────────────────────────────────────
function parseTemplate(file, raw) {
  const m = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) throw new Error(`${file}: missing frontmatter`);
  const meta = {};
  for (const line of m[1].split('\n')) {
    const i = line.indexOf(':');
    if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  for (const key of ['name', 'section', 'subject']) {
    if (!meta[key]) throw new Error(`${file}: frontmatter needs "${key}"`);
  }
  meta.stores = (meta.stores || 'india, global').split(',').map((s) => s.trim());
  meta.previews = (meta.previews || '').split(',').map((s) => s.trim()).filter(Boolean);
  const parts = m[2].split(/^<!-- body -->\n/m);
  if (parts.length !== 2) throw new Error(`${file}: needs exactly one "<!-- body -->" line`);
  return { meta, prelude: parts[0], body: parts[1] };
}

async function inlinePartials(text, stack = []) {
  const re = /\{%-?\s*render\s+'([a-z0-9-]+)'\s*-?%\}/g;
  let out = '';
  let last = 0;
  for (const m of text.matchAll(re)) {
    const name = m[1];
    if (stack.includes(name)) throw new Error(`partial cycle: ${[...stack, name].join(' → ')}`);
    const partial = await readFile(path.join(SRC, 'partials', `${name}.liquid`), 'utf8');
    out += text.slice(last, m.index) + (await inlinePartials(partial.trimEnd(), [...stack, name]));
    last = m.index + m[0].length;
  }
  return out + text.slice(last);
}

function applyStyles(text, file) {
  return text.replace(/%%([a-z0-9-]+)%%/g, (_, key) => {
    if (!(key in STYLES)) throw new Error(`${file}: unknown style token %%${key}%%`);
    return STYLES[key];
  });
}

function storePrelude(store) {
  const lines = Object.entries(STORES[store]).map(
    ([k, v]) => `{%- assign ${k} = '${String(v).replace(/'/g, '&#39;')}' -%}`,
  );
  return `{%- comment -%} Mir Kash — ${store === 'india' ? 'India' : 'Global'} store. Built from shopify-emails/src; edit there, not here. {%- endcomment -%}\n${lines.join('\n')}\n`;
}

async function assemble(file, tpl, layout, store) {
  const page = layout.replace('%%BODY%%', () => tpl.body.trimEnd());
  let out = storePrelude(store) + tpl.prelude.trimEnd() + '\n' + page;
  out = await inlinePartials(out);
  out = applyStyles(out, file);
  if (/\{%-?\s*render\s/.test(out)) throw new Error(`${file}: render tag left after inlining`);
  if (/%%[A-Za-z0-9-]+%%/.test(out)) throw new Error(`${file}: unreplaced token`);
  return out;
}

// ── Preview engine: liquidjs with stand-ins for Shopify's notification filters ──
function makeEngine(fixture) {
  const engine = new Liquid({ strictFilters: true });
  const fmt = fixture._money_format || '${{amount}}';
  const currency = fixture._currency || 'USD';
  const locale = fixture._locale || 'en-US';
  const toNum = (cents) => Number(cents || 0) / 100;
  const amount = (cents, decimals) =>
    toNum(cents).toLocaleString(locale, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  const money = (cents) =>
    fmt.replace('{{amount_no_decimals}}', amount(cents, 0)).replace('{{amount}}', amount(cents, 2));
  engine.registerFilter('money', money);
  engine.registerFilter('money_with_currency', (c) => `${money(c)} ${currency}`);
  engine.registerFilter('money_without_trailing_zeros', (c) =>
    Number(c) % 100 === 0 ? fmt.replace(/\{\{amount(_no_decimals)?\}\}/, amount(c, 0)) : money(c),
  );
  engine.registerFilter('img_url', (item) => {
    const img = item?.image ?? item?.line_item?.image ?? item;
    return (img && (img.src || (typeof img === 'string' ? img : ''))) || '';
  });
  engine.registerFilter('format_address', (a) =>
    !a
      ? ''
      : [
          [a.first_name, a.last_name].filter(Boolean).join(' '),
          a.company,
          a.address1,
          a.address2,
          [a.city, a.province_code, a.zip].filter(Boolean).join(' '),
          a.country,
        ]
          .filter(Boolean)
          .join('<br>'),
  );
  return engine;
}

function deepMerge(a, b) {
  if (Array.isArray(b) || typeof b !== 'object' || b === null) return b;
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) out[k] = k in (a || {}) ? deepMerge(a[k], v) : v;
  return out;
}

async function loadFixture(store, variant) {
  const base = JSON.parse(await readFile(path.join(ROOT, 'fixtures', `${store}.json`), 'utf8'));
  if (!variant) return base;
  const over = JSON.parse(await readFile(path.join(ROOT, 'fixtures', `${store}--${variant}.json`), 'utf8'));
  return deepMerge(base, over);
}

// ── Main ─────────────────────────────────────────────────────────────────────
const layout = await readFile(path.join(SRC, 'layout.liquid'), 'utf8');
const files = (await readdir(path.join(SRC, 'templates'))).filter((f) => f.endsWith('.liquid')).sort();

await rm(DIST, { recursive: true, force: true });
await rm(PREVIEW, { recursive: true, force: true });
for (const store of Object.keys(STORES)) {
  await mkdir(path.join(DIST, store), { recursive: true });
  await mkdir(path.join(PREVIEW, store), { recursive: true });
}

const subjects = { india: [], global: [] };
const previews = [];
let failures = 0;

for (const file of files) {
  const slug = file.replace(/\.liquid$/, '');
  const tpl = parseTemplate(file, await readFile(path.join(SRC, 'templates', file), 'utf8'));
  for (const store of tpl.meta.stores) {
    if (!STORES[store]) throw new Error(`${file}: unknown store "${store}"`);
    const out = await assemble(file, tpl, layout, store);
    await writeFile(path.join(DIST, store, `${slug}.liquid`), out);
    subjects[store].push(tpl.meta);
    tpl.meta.slug = slug;

    for (const variant of ['', ...tpl.meta.previews]) {
      let fixture;
      try {
        fixture = await loadFixture(store, variant);
      } catch {
        continue; // this store has no fixture for that variant
      }
      const name = variant ? `${slug}--${variant}` : slug;
      try {
        const engine = makeEngine(fixture);
        const html = await engine.parseAndRender(out, fixture);
        const subject = await engine.parseAndRender(tpl.meta.subject, fixture);
        // The logo PNGs only exist on the live site after a deploy: point previews at the repo copies.
        const local = html.split(`${STORES[store].mk_assets}/`).join('../../../public/email/');
        await writeFile(path.join(PREVIEW, store, `${name}.html`), local);
        previews.push({ store, name, title: tpl.meta.name, section: tpl.meta.section, subject, variant });
      } catch (err) {
        failures++;
        console.error(`✗ ${store}/${name}: ${err.message}`);
      }
    }
  }
}

// SUBJECTS.md per store: the admin name, the file, and the subject line to paste.
for (const [store, list] of Object.entries(subjects)) {
  const bySection = {};
  for (const t of list) (bySection[t.section] ||= []).push(t);
  let md = `# ${store === 'india' ? 'India' : 'Global'} store: subject lines\n\nGenerated by \`scripts/build-shopify-emails.mjs\`. For each notification, paste the subject below and the body from the matching \`.liquid\` file.\n`;
  for (const [section, items] of Object.entries(bySection)) {
    md += `\n## ${section}\n\n| Shopify notification | File | Subject |\n|---|---|---|\n`;
    for (const t of items) md += `| ${t.name} | \`${t.slug}.liquid\` | \`${t.subject.replace(/\|/g, '\\|')}\` |\n`;
  }
  await writeFile(path.join(DIST, store, 'SUBJECTS.md'), md);
}

// Preview index: every template, both stores, side by side.
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const rows = previews
  .map(
    (p) =>
      `<tr><td>${esc(p.section)}</td><td>${esc(p.title)}${p.variant ? ` <small>(${esc(p.variant)})</small>` : ''}</td><td>${p.store}</td><td>${esc(p.subject)}</td><td><a href="${p.store}/${p.name}.html" target="frame">open</a></td></tr>`,
  )
  .join('\n');
await writeFile(
  path.join(PREVIEW, 'index.html'),
  `<!doctype html><meta charset="utf-8"><title>Mir Kash emails: previews</title>
<style>body{margin:0;font:14px/1.4 -apple-system,system-ui,sans-serif;display:flex;height:100vh}nav{width:52%;overflow:auto;padding:16px;box-sizing:border-box}table{border-collapse:collapse;width:100%}td{padding:6px 8px;border-bottom:1px solid #eee;vertical-align:top}iframe{flex:1;border:0;border-left:1px solid #ddd}label{display:block;margin-bottom:10px}</style>
<nav><h1 style="font-size:18px">Mir Kash notification previews</h1><label>Frame width <select onchange="frame.style.maxWidth=this.value"><option value="none">full</option><option value="375px">375px (phone)</option><option value="600px">600px</option></select></label><table>${rows}</table></nav>
<iframe name="frame" id="frame"></iframe>`,
);

const count = Object.values(subjects).reduce((n, l) => n + l.length, 0);
console.log(`Built ${count} templates (${subjects.india.length} India, ${subjects.global.length} Global), ${previews.length} previews.`);
if (failures) {
  console.error(`${failures} preview(s) failed to render.`);
  process.exit(1);
}
