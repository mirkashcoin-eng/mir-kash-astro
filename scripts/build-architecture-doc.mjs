// Generates "Mir-Kash-Technical-Documentation.docx" — a complete, detailed explanation
// of how the entire website works: tech stack, frontend, backend, multi-market routing,
// data layer, both payment gateways, webhooks + reconciliation, accounts, order lifecycle,
// security, deployment, and a file-by-file reference. With diagrams (SVG->PNG via sharp).
// Run: node scripts/build-architecture-doc.mjs
import {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
  ImageRun, Table, TableRow, TableCell, WidthType, BorderStyle, ShadingType, PageBreak,
} from 'docx';
import sharp from 'sharp';
import { writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

// ── Brand palette ────────────────────────────────────────────────────────────
const CHERRY = '8B1A1A', INK = '2C1A0E', MID = '6E6A64', GREEN = '2F6B3F', BLUE = '2C4A7A';
const FONT = 'Calibri', MONO = 'Consolas';
const C = { cherry: '#8B1A1A', ink: '#2C1A0E', paper: '#FBF9F5', rule: '#E4DFD7', mid: '#8a857d', green: '#2f6b3f', blue: '#2c4a7a', soft: '#F3EFE8', gold: '#B07A2A' };

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
function wrap(text, max) {
  const words = String(text).split(' '); const lines = []; let cur = '';
  for (const w of words) { if ((cur + ' ' + w).trim().length > max) { if (cur) lines.push(cur); cur = w; } else cur = (cur + ' ' + w).trim(); }
  if (cur) lines.push(cur); return lines;
}

// ── docx helpers ─────────────────────────────────────────────────────────────
const H1 = (t) => new Paragraph({ heading: HeadingLevel.HEADING_1, spacing: { before: 340, after: 140 }, children: [new TextRun({ text: t, font: FONT, bold: true, size: 34, color: CHERRY })] });
const H2 = (t) => new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { before: 240, after: 100 }, children: [new TextRun({ text: t, font: FONT, bold: true, size: 26, color: INK })] });
const H3 = (t) => new Paragraph({ spacing: { before: 160, after: 70 }, children: [new TextRun({ text: t, font: FONT, bold: true, size: 22, color: BLUE })] });
function P(runs, opts = {}) {
  const arr = Array.isArray(runs) ? runs : [runs];
  return new Paragraph({ spacing: { after: opts.after ?? 120, line: 276 }, alignment: opts.align, children: arr.map((r) => typeof r === 'string' ? new TextRun({ text: r, font: FONT, size: 21, color: '222222' }) : new TextRun({ font: FONT, size: 21, color: '222222', ...r })) });
}
const bullet = (runs) => {
  const arr = Array.isArray(runs) ? runs : [runs];
  return new Paragraph({ bullet: { level: 0 }, spacing: { after: 60, line: 270 }, children: arr.map((r) => typeof r === 'string' ? new TextRun({ text: r, font: FONT, size: 21, color: '222222' }) : new TextRun({ font: FONT, size: 21, color: '222222', ...r })) });
};
function codeBlock(lines) {
  const arr = String(lines).split('\n');
  return new Paragraph({
    spacing: { before: 80, after: 140 }, shading: { type: ShadingType.SOLID, color: 'F4F1EC' },
    border: { top: { style: BorderStyle.SINGLE, size: 4, color: 'E0D8CC' }, bottom: { style: BorderStyle.SINGLE, size: 4, color: 'E0D8CC' }, left: { style: BorderStyle.SINGLE, size: 12, color: CHERRY }, right: { style: BorderStyle.SINGLE, size: 4, color: 'E0D8CC' } },
    children: arr.flatMap((ln, i) => [new TextRun({ text: ln, font: MONO, size: 17, color: '3A2E22' }), ...(i < arr.length - 1 ? [new TextRun({ break: 1 })] : [])]),
  });
}
async function svgImage(svgObj, maxW = 620) {
  const { svg, W, H } = svgObj;
  const scale = 2;
  const png = await sharp(Buffer.from(svg), { density: 96 * scale }).resize(Math.round(W * scale), Math.round(H * scale)).png().toBuffer();
  const w = Math.min(maxW, W), h = Math.round((w / W) * H);
  return new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 120, after: 160 }, children: [new ImageRun({ type: 'png', data: png, transformation: { width: w, height: h } })] });
}
const caption = (t) => new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 200 }, children: [new TextRun({ text: t, font: FONT, italics: true, size: 17, color: MID })] });

function cell(text, { bold, bg, color, w, align } = {}) {
  const runs = Array.isArray(text) ? text : [text];
  return new TableCell({
    width: w ? { size: w, type: WidthType.PERCENTAGE } : undefined,
    shading: bg ? { type: ShadingType.SOLID, color: bg } : undefined,
    margins: { top: 60, bottom: 60, left: 90, right: 90 },
    children: [new Paragraph({ alignment: align, spacing: { after: 0, line: 250 }, children: runs.map((r) => typeof r === 'string' ? new TextRun({ text: r, font: FONT, size: 18, bold, color: color || '333333' }) : new TextRun({ font: FONT, size: 18, ...r })) })],
  });
}
function table(headers, rows, widths) {
  const border = { style: BorderStyle.SINGLE, size: 3, color: 'D9D2C6' };
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: { top: border, bottom: border, left: border, right: border, insideHorizontal: border, insideVertical: border },
    rows: [
      new TableRow({ tableHeader: true, children: headers.map((h, i) => cell(h, { bold: true, bg: CHERRY, color: 'FFFFFF', w: widths?.[i] })) }),
      ...rows.map((r, ri) => new TableRow({ children: r.map((c, i) => cell(c, { bg: ri % 2 ? 'FBF9F5' : 'FFFFFF', w: widths?.[i] })) })),
    ],
  });
}
const spacer = () => new Paragraph({ text: '', spacing: { after: 60 } });

// ═══════════════════════════════════════════════════════════════════════════════
// DIAGRAMS
// ═══════════════════════════════════════════════════════════════════════════════
function box(x, y, w, h, label, sub, fill, stroke, txt = C.ink, lblSize = 15, subSize = 11) {
  let g = `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="10" fill="${fill}" stroke="${stroke}" stroke-width="1.8"/>`;
  const lines = wrap(label, Math.floor(w / 8.5)), lh = lblSize + 4;
  const totalH = lines.length * lh + (sub ? subSize + 5 : 0);
  let sy = y + h / 2 - totalH / 2 + lblSize;
  lines.forEach((ln) => { g += `<text x="${x + w / 2}" y="${sy}" font-family="Arial" font-size="${lblSize}" font-weight="700" fill="${txt}" text-anchor="middle">${esc(ln)}</text>`; sy += lh; });
  if (sub) { wrap(sub, Math.floor(w / 6.5)).forEach((ln) => { g += `<text x="${x + w / 2}" y="${sy + 1}" font-family="Arial" font-size="${subSize}" fill="${txt}" text-anchor="middle">${esc(ln)}</text>`; sy += subSize + 3; }); }
  return g;
}
const arrow = (x1, y1, x2, y2, color) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color || C.mid}" stroke-width="2.2" marker-end="url(#ah)"/>`;
const dArrow = (x1, y1, x2, y2, color) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color || C.mid}" stroke-width="2.2" stroke-dasharray="5 4" marker-end="url(#ah)"/>`;
const lbl = (x, y, text, color, anchor, size) => `<text x="${x}" y="${y}" font-family="Arial" font-size="${size || 11.5}" font-weight="700" fill="${color || C.mid}" text-anchor="${anchor || 'middle'}">${esc(text)}</text>`;
const defs = `<defs><marker id="ah" markerWidth="12" markerHeight="12" refX="6" refY="5" orient="auto"><path d="M0,0 L9,5 L0,10 Z" fill="${C.mid}"/></marker></defs>`;

// High-level architecture
function archDiagram() {
  const W = 940, H = 620; let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect width="${W}" height="${H}" fill="${C.paper}"/>${defs}`;
  s += box(360, 20, 220, 56, 'Customer Browser', 'phone / laptop', '#EAF3EC', C.green);
  // Vercel container
  s += `<rect x="250" y="120" width="440" height="220" rx="12" fill="#ffffff" stroke="${C.cherry}" stroke-width="2"/>`;
  s += `<text x="470" y="146" font-family="Arial" font-size="15" font-weight="700" fill="${C.cherry}" text-anchor="middle">Vercel  —  Astro SSR (our app)</text>`;
  s += box(266, 160, 190, 50, 'Middleware', 'market routing', '#F3EFE8', C.ink, C.ink, 13, 10);
  s += box(484, 160, 190, 50, '.astro Pages', 'server-rendered UI', '#F3EFE8', C.ink, C.ink, 13, 10);
  s += box(266, 230, 190, 50, 'API Routes', 'checkout · account · cron', '#FCEFEF', C.cherry, C.ink, 13, 10);
  s += box(484, 230, 190, 50, 'Webhooks', 'cashfree', '#FCEFEF', C.cherry, C.ink, 13, 10);
  s += box(360, 292, 220, 40, 'src/lib (TypeScript logic)', '', '#EFF3FB', C.blue, C.ink, 12.5, 10);
  // External services
  s += box(30, 400, 180, 66, 'Shopify', 'India + Global stores', '#ffffff', C.ink);
  s += box(230, 400, 180, 66, 'Cashfree', 'India payments (UPI/Card)', '#ffffff', C.gold);
  s += box(430, 400, 180, 66, 'Firebase', 'accounts + profiles', '#ffffff', C.blue);
  s += box(630, 400, 130, 66, 'Supabase', 'WhatsApp bot', '#ffffff', C.green);
  s += box(780, 400, 130, 66, 'Meta', 'WhatsApp API', '#EAF3EC', C.green);
  // Arrows
  s += arrow(470, 118, 470, 78, C.cherry); s += lbl(530, 104, 'HTTPS requests', C.cherry, 'middle');
  s += arrow(120, 400, 300, 344, C.ink); s += lbl(150, 372, 'Storefront + Admin API', C.ink, 'start', 10.5);
  s += arrow(320, 400, 380, 344, C.gold);
  s += arrow(520, 400, 490, 344, C.blue);
  s += arrow(690, 400, 560, 340, C.green); s += lbl(690, 372, 'Shopify order webhooks', C.green, 'middle', 10);
  s += arrow(760, 433, 780, 433, C.green);
  s += `</svg>`; return { svg: s, W, H };
}

// Vertical flow
function vflow(steps, opts = {}) {
  const accent = new Set(opts.accent || []); const bw = opts.bw || 560, bh = 62, gap = 26, mx = 16, my = 16;
  const W = bw + mx * 2, n = steps.length, H = my * 2 + n * bh + (n - 1) * gap;
  let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect width="${W}" height="${H}" fill="${C.paper}"/>${defs}`;
  steps.forEach((step, i) => {
    const x = mx, y = my + i * (bh + gap), isA = accent.has(i);
    const fill = isA ? C.cherry : '#ffffff', stroke = isA ? C.cherry : C.ink, txt = isA ? '#ffffff' : C.ink;
    s += `<rect x="${x}" y="${y}" width="${bw}" height="${bh}" rx="9" fill="${fill}" stroke="${stroke}" stroke-width="1.6"/>`;
    const bx = x + 30, by = y + bh / 2;
    s += `<circle cx="${bx}" cy="${by}" r="14" fill="${isA ? '#ffffff' : C.cherry}"/><text x="${bx}" y="${by + 5}" font-family="Arial" font-size="14" font-weight="700" fill="${isA ? C.cherry : '#fff'}" text-anchor="middle">${i + 1}</text>`;
    const lines = wrap(step, 62), lh = 17, startY = by - (lines.length - 1) * lh / 2 + 5;
    lines.forEach((ln, li) => { s += `<text x="${x + 58}" y="${startY + li * lh}" font-family="Arial" font-size="13.5" fill="${txt}" text-anchor="start">${esc(ln)}</text>`; });
    if (i < n - 1) s += arrow(W / 2, y + bh + 3, W / 2, y + bh + gap - 3);
  });
  s += `</svg>`; return { svg: s, W, H };
}

// Three-layer payment confirmation
function confirmDiagram() {
  const W = 900, H = 430; let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect width="${W}" height="${H}" fill="${C.paper}"/>${defs}`;
  s += box(340, 20, 220, 54, 'Customer pays on Cashfree', '', '#FDF3E3', C.gold);
  s += box(60, 150, 230, 78, 'Layer 1 — Return page', 'browser redirected to /checkout/return; verifies status server-side', '#EAF3EC', C.green, C.ink, 13.5, 10);
  s += box(335, 150, 230, 78, 'Layer 2 — Webhook', 'Cashfree calls /api/webhooks/cashfree (HMAC-verified)', '#EFF3FB', C.blue, C.ink, 13.5, 10);
  s += box(610, 150, 230, 78, 'Layer 3 — Reconciler', 'daily cron sweeps unpaid-looking drafts, completes paid ones', '#FCEFEF', C.cherry, C.ink, 13.5, 10);
  s += box(320, 320, 260, 64, 'completeDraftOrder()', 'draft -> real PAID Shopify order (idempotent)', '#ffffff', C.ink, C.ink, 14, 10.5);
  s += arrow(400, 148, 250, 74, C.green); s += arrow(450, 148, 450, 74, C.blue); s += arrow(500, 148, 660, 74, C.cherry);
  s += arrow(230, 228, 400, 318, C.green); s += arrow(450, 228, 450, 318, C.blue); s += arrow(690, 228, 520, 318, C.cherry);
  s += lbl(450, 300, 'all three call the same idempotent function', MID, 'middle', 11);
  s += `</svg>`; return { svg: s, W, H };
}

// Order lifecycle states
function stateDiagram() {
  const W = 900, H = 300; let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect width="${W}" height="${H}" fill="${C.paper}"/>${defs}`;
  const y = 60, w = 150, h = 58;
  s += box(20, y, w, h, 'Cart', 'Storefront cart', '#F3EFE8', C.ink, C.ink, 14, 10);
  s += box(200, y, w, h, 'Draft Order', 'created before pay', '#FDF3E3', C.gold, C.ink, 14, 10);
  s += box(380, y, w, h, 'Paid Order', 'online / COD', '#EAF3EC', C.green, C.ink, 14, 10);
  s += box(560, y, w, h, 'Fulfilled', 'shipped + tracking', '#EFF3FB', C.blue, C.ink, 14, 10);
  s += box(740, y, w, h, 'Delivered', 'past order', '#EAF3EC', C.green, C.ink, 14, 10);
  s += arrow(170, y + h / 2, 200, y + h / 2); s += arrow(350, y + h / 2, 380, y + h / 2); s += arrow(530, y + h / 2, 560, y + h / 2); s += arrow(710, y + h / 2, 740, y + h / 2);
  s += lbl(275, y - 8, 'create', C.gold); s += lbl(455, y - 8, 'verify pay', C.green);
  // cancel branch
  s += box(290, 190, 150, 54, 'Cancelled', 'restock + refund flag', '#FCEFEF', C.cherry, C.ink, 13.5, 10);
  s += arrow(430, y + h, 380, 190, C.cherry); s += lbl(455, 165, 'cancel before ship', C.cherry, 'start', 10.5);
  s += `</svg>`; return { svg: s, W, H };
}

// ═══════════════════════════════════════════════════════════════════════════════
// BUILD
// ═══════════════════════════════════════════════════════════════════════════════
const A = archDiagram(), MW = vflow([
  'Request arrives. Skip static assets, bots and /api routes.',
  'Legacy /en-in/* is 301-redirected to the root (India lives at /).',
  'Resolve the market from the URL prefix (root = India by default).',
  'If a locale is already in the URL (e.g. /en-us), respect it — no redirect.',
  'Else check the market cookie (a manual country choice wins).',
  'Else geo-detect from x-vercel-ip-country and redirect if not India.',
  'Attach market + marketConfig to Astro.locals for every page.',
]);
const CHK = vflow([
  'Customer fills Contact -> Delivery -> Payment (UPI / Card / COD) on /checkout.',
  'Browser POSTs to /api/checkout/create with address + cart.',
  'Server reads the Shopify cart and creates a DRAFT ORDER (Shopify Admin API).',
  'COD: complete the draft now as "payment pending" -> done. Online: continue.',
  'Server creates a Cashfree order -> gets a payment_session_id.',
  'Browser opens Cashfree with cashfree.checkout(payment_session_id).',
  'Customer pays. Cashfree confirms via redirect AND webhook (not the browser claim).',
  'Server verifies status with Cashfree, then completes the draft into a paid order.',
], { accent: [4, 6] });
const CONF = confirmDiagram(), STATE = stateDiagram();
const GCHK = vflow([
  'Global customer adds to cart (Storefront cart on the Global store).',
  'Clicks Checkout -> we redirect to Shopify\'s hosted checkout URL (cart.checkoutUrl).',
  'Shopify handles payment, taxes, and order creation entirely on its side.',
  'No custom payment code — the Global store is a standard Shopify checkout.',
], { bw: 600 });

const images = await Promise.all([svgImage(A, 640), svgImage(MW, 600), svgImage(CHK, 620), svgImage(CONF, 660), svgImage(STATE, 660), svgImage(GCHK, 600)]);
const [imgArch, imgMw, imgChk, imgConf, imgState, imgGchk] = images;

const title = (t, sub) => [
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 1400, after: 60 }, children: [new TextRun({ text: t, font: FONT, bold: true, size: 56, color: CHERRY })] }),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 40 }, children: [new TextRun({ text: sub, font: FONT, size: 26, color: INK })] }),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 30 }, children: [new TextRun({ text: 'Complete Technical Documentation', font: FONT, italics: true, size: 22, color: MID })] }),
  new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'Generated 5 July 2026', font: FONT, size: 18, color: MID })] }),
  new Paragraph({ children: [new PageBreak()] }),
];

const doc = new Document({
  styles: { default: { document: { run: { font: FONT } } } },
  sections: [{
    properties: { page: { margin: { top: 900, bottom: 900, left: 1100, right: 1100 } } },
    children: [
      ...title('MIR KASH', 'How the Website Works, End to End'),

      // 1. OVERVIEW
      H1('1. Executive Overview'),
      P('Mir Kash is a headless luxury handbag e-commerce website. "Headless" means the storefront (what customers see and click) is a custom-built application, while the commerce engine (products, carts, orders, inventory, tax) is Shopify running invisibly in the background.'),
      P('There are two Shopify stores behind one website: an India store and a Global store. India uses a fully custom checkout with the Cashfree payment gateway; every other country uses Shopify’s own hosted checkout. Customer accounts run on Firebase, and order-update WhatsApp messages run on a separate Supabase + Meta system.'),
      P([{ text: 'The single most important design idea: ', bold: true }, 'the browser is never trusted for anything that matters. Prices, payment confirmation, and order creation are all decided on our server after independently checking with Shopify and Cashfree.']),

      H1('2. Technology Stack'),
      P('The whole codebase is written in TypeScript (a safer, typed version of JavaScript). There is no separate "backend language" — the frontend and backend are the same Astro project; some files render pages, others run as server functions.'),
      table(['Layer', 'Technology', 'What it does'], [
        ['Framework', 'Astro 5 (SSR mode)', 'Renders pages on the server and hosts the API routes.'],
        ['Language', 'TypeScript', 'All app logic, frontend and backend.'],
        ['Frontend UI', '.astro components + vanilla JS', 'HTML/CSS with small sprinkles of browser JavaScript. No React, no Tailwind — hand-written CSS.'],
        ['Styling', 'Global CSS + scoped styles, Jost font', 'public/styles.css plus per-component <style> blocks.'],
        ['Hosting', 'Vercel (@astrojs/vercel)', 'Serverless hosting; each API route becomes a cloud function.'],
        ['Commerce', 'Shopify (2 stores)', 'Products, carts, orders, inventory, GST/tax.'],
        ['Storefront data', '@shopify/storefront-api-client', 'Reads products + manages carts (GraphQL).'],
        ['Order engine', 'Shopify Admin API', 'Creates/manages India orders (draft orders).'],
        ['Payments (India)', 'Cashfree + @cashfreepayments/cashfree-js', 'UPI / cards / net-banking for the India custom checkout.'],
        ['Payments (Global)', 'Shopify hosted checkout', 'Standard Shopify payment page.'],
        ['Accounts', 'Firebase (Google Auth + Firestore)', 'Sign-in and saved profile/address.'],
        ['Token verification', 'jose (JWT)', 'Verifies Firebase login tokens on the server.'],
        ['Notifications', 'Supabase + Meta WhatsApp Cloud API', 'Order WhatsApp messages (separate project).'],
      ], [16, 30, 54]),

      new Paragraph({ children: [new PageBreak()] }),
      H1('3. High-Level Architecture'),
      P('Everything runs through our Astro app on Vercel. The app renders pages, exposes API routes, and talks server-to-server with Shopify, Cashfree, Firebase, and (for WhatsApp) Supabase + Meta. The customer’s browser only ever talks to our app — never directly to Shopify Admin or Cashfree secrets.'),
      imgArch, caption('Figure 1 — High-level architecture. The browser talks only to our Vercel app; the app talks to the external services.'),

      H1('4. Frontend — What the Customer Sees'),
      P('The frontend is built from .astro components. Each page is assembled on the server from these components and sent to the browser as ready HTML (fast, SEO-friendly). Small pieces of browser JavaScript handle interactivity (add-to-cart, the checkout steps, account sign-in).'),
      H3('Pages (src/pages)'),
      P('India pages live at the root; Global pages live under /[locale]/ (e.g. /en-us/shop). The same components render both — only the market config differs.'),
      table(['Route', 'Purpose'], [
        ['/  (index)', 'Homepage — hero, 3 product scrollers, editorial panels.'],
        ['/shop', 'Shop-all product grid.'],
        ['/products/[handle]', 'Product detail page (PDP) with gallery, swatches, add-to-cart.'],
        ['/cart', 'Cart page.'],
        ['/checkout', 'India custom checkout (Contact -> Delivery -> Payment).'],
        ['/checkout/return', 'Where Cashfree sends the customer after paying; verifies + shows result.'],
        ['/account', 'Sign-in + profile + order history.'],
        ['/account/orders/[id]', 'Order Summary page (timeline, items, cancel, reorder).'],
        ['/pages/* ', 'About, Materials, FAQ, Contact, Bulk Gifting, Returns, legal pages.'],
        ['/api/*', 'Server functions (not pages) — see the backend sections.'],
      ], [30, 70]),
      H3('Key UI components (src/components)'),
      table(['Component', 'Responsibility'], [
        ['BaseLayout.astro', 'The HTML shell (head, fonts, styles.css) that wraps every page.'],
        ['SiteHeader / SiteFooter / NavDrawer', 'Global navigation, cart icon, account icon.'],
        ['Homepage.astro', 'Homepage sections + wiring collections to the 3 scrollers.'],
        ['ProductRow / ProductCard', 'Horizontal product scrollers and individual product tiles.'],
        ['ProductPage.astro', 'Product detail: gallery, colour swatches, options, buy buttons.'],
        ['ShopAll.astro', 'The shop grid.'],
        ['CartPage.astro', 'Cart line items, quantities, coupon field.'],
        ['CheckoutPage.astro', 'The India 3-step checkout UI + payment logic.'],
        ['AccountPage.astro', 'Sign-in, saved address, order-history list.'],
      ], [30, 70]),

      new Paragraph({ children: [new PageBreak()] }),
      H1('5. Multi-Market Routing (India vs the World)'),
      P('One website serves ~30+ countries. India is the default and lives at the root (INR, India Shopify store). Every other country is the Global store priced in its own currency. A "middleware" file runs on every request and decides which market the visitor is in.'),
      H3('How a request is routed (src/middleware.ts)'),
      imgMw, caption('Figure 2 — The middleware decides the market on every request and attaches it to Astro.locals.'),
      P([{ text: 'src/lib/markets.ts', font: MONO }, ' holds the market table: each market has a store (india/global), country code, currency + symbol, URL prefix, and locale. ', { text: 'STORE_CREDS', font: MONO }, ' maps each store to its Shopify domain + Storefront token (read from environment variables).']),
      codeBlock('export const STORE_CREDS = {\n  india:  { shopifyDomain: env(\'SHOPIFY_IN_DOMAIN\'),     shopifyToken: env(\'SHOPIFY_IN_TOKEN\') },\n  global: { shopifyDomain: env(\'SHOPIFY_GLOBAL_DOMAIN\'), shopifyToken: env(\'SHOPIFY_GLOBAL_TOKEN\') },\n};'),

      H1('6. Data Layer — Talking to Shopify'),
      P('There are two different Shopify APIs, used for two different jobs:'),
      bullet([{ text: 'Storefront API ', bold: true }, '(public, safe token) — reads products and manages the shopping cart. Used by both stores.']),
      bullet([{ text: 'Admin API ', bold: true }, '(secret, India only) — creates and completes orders, reads order history, cancels orders. This is the powerful key and lives server-side only.']),
      H3('Storefront client (src/lib/shopify/client.ts)'),
      P([{ text: 'getClient(store)', font: MONO }, ' builds a Storefront client for the right store; ', { text: 'runQuery(store, query, vars, country)', font: MONO }, ' runs a GraphQL query with an @inContext(country, language) directive so prices come back in the visitor’s currency.']),
      table(['File', 'What it provides'], [
        ['shopify/client.ts', 'Storefront GraphQL client + runQuery (per store, per country).'],
        ['shopify/queries.ts', 'getProductsByCollection, getAllProducts, getProductByHandle.'],
        ['shopify/fragments.ts', 'Reusable GraphQL fragments (product, image, price).'],
        ['shopify/cart.ts', 'createCart, addLines, getCart, applyDiscount (Storefront cart).'],
        ['shopify/admin.ts', 'India Admin API: draft orders, order history, cancel, reconcile.'],
        ['cart-session.ts', 'Stores cart ids in cookies (main + buy-now, per store).'],
      ], [28, 72]),
      H3('The Admin token (client-credentials grant)'),
      P('The India Admin app no longer hands out a static token. Instead the server exchanges the app’s Client ID + Secret for a short-lived (~24h) token and caches it. This happens inside admin.ts and never touches the browser.'),

      new Paragraph({ children: [new PageBreak()] }),
      H1('7. Database Mapping — Where Every Piece of Data Lives'),
      P('There is no single database. Each system owns the data it is best at, and they are linked by shared keys (the customer’s email, and the Cashfree order id stored on the Shopify draft).'),
      table(['Data', 'Lives in', 'Key / mapping'], [
        ['Products, variants, images, prices', 'Shopify (per store)', 'product handle (e.g. carla-taupe).'],
        ['Shopping cart', 'Shopify Storefront cart', 'cart id stored in a browser cookie (cart-session.ts).'],
        ['Orders, payment + fulfillment status', 'Shopify Orders', 'order number (#1048108); email links to the customer.'],
        ['Pending checkout (pre-payment)', 'Shopify Draft Order', 'draft id; also carries the Cashfree order id as a custom attribute.'],
        ['Customer account + saved address', 'Firebase Firestore', 'Firebase user id (uid); email links to Shopify orders.'],
        ['Login identity', 'Firebase Auth (Google)', 'verified email inside the login token.'],
        ['Payment transactions (India)', 'Cashfree', 'Cashfree order id mk_...; tag draft_order_id links back to Shopify.'],
        ['WhatsApp message logs + config', 'Supabase (Postgres)', 'Shopify store domain + order number.'],
      ], [26, 26, 48]),
      P([{ text: 'The crucial link: ', bold: true }, 'when we create a Cashfree order we tag it with the Shopify ', { text: 'draft_order_id', font: MONO }, ', and we store the Cashfree ', { text: 'cf_order_id', font: MONO }, ' on the Shopify draft. This two-way link is what lets the return page, the webhook, and the reconciler all find the matching order and complete it.']),

      H1('8. The India Custom Checkout + Cashfree'),
      P('India uses our own 3-step checkout instead of Shopify’s. This lets us use Cashfree (UPI/cards) and avoid Shopify’s checkout commission, while Shopify still owns the final order (so GST, inventory and records stay correct).'),
      imgChk, caption('Figure 3 — The India checkout. Steps 5 & 7 (highlighted) are the payment hand-off and the server-side verification.'),
      H3('Step by step, with the files involved'),
      table(['Stage', 'File', 'What happens'], [
        ['Checkout UI', 'CheckoutPage.astro', 'Collects contact, address, and payment choice (UPI/Card/COD).'],
        ['Create order', 'api/checkout/create.ts', 'Builds a Shopify draft order; for online, creates the Cashfree order.'],
        ['Draft + admin', 'lib/shopify/admin.ts', 'createDraftOrder / completeDraftOrder via the Admin API.'],
        ['Cashfree calls', 'lib/cashfree.ts', 'createCashfreeOrder, getCashfreeOrder, finalizeOrder, verify signature.'],
        ['Buy Now', 'api/checkout/buynow.ts', 'Single-item express checkout (separate cart).'],
        ['Return page', 'pages/checkout/return.astro', 'Verifies payment with Cashfree, then completes the order.'],
      ], [18, 32, 50]),
      P([{ text: 'Cash on Delivery: ', bold: true }, 'no online payment. The draft is completed immediately as "payment pending" — a real order that you mark paid once cash is collected. Only one boolean differs from the online path (', { text: 'paymentPending: true', font: MONO }, ').']),

      new Paragraph({ children: [new PageBreak()] }),
      H1('9. Payment Confirmation — Why It Can’t Be Faked, and Never Lost'),
      P('After a customer pays, Cashfree does NOT tell our webpage “paid”. Trusting the browser would let anyone fake an order. Instead we confirm the payment three independent ways, and every one of them re-checks the real status with Cashfree before creating the order.'),
      imgConf, caption('Figure 4 — Three independent confirmation paths, all calling the same idempotent completeDraftOrder().'),
      table(['Path', 'When it fires', 'File'], [
        ['1. Return page', 'Customer’s browser returns after paying', 'pages/checkout/return.astro'],
        ['2. Webhook', 'Cashfree’s server notifies us (even if the tab is closed)', 'api/webhooks/cashfree.ts'],
        ['3. Reconciler', 'A daily cron sweeps for any paid-but-uncompleted order', 'api/cron/reconcile-orders.ts'],
      ], [22, 46, 32]),
      P([{ text: 'Idempotent = safe to run twice. ', bold: true }, 'All three call ', { text: 'completeDraftOrder()', font: MONO }, ', which first checks if the draft is already completed and does nothing if so. So overlapping confirmations never create a duplicate order.']),
      H3('Security of the payment path'),
      bullet([{ text: 'Server-side verification: ', bold: true }, 'we call Cashfree’s Get-Order API and only proceed if order_status === "PAID".']),
      bullet([{ text: 'Amount is server-computed: ', bold: true }, 'the charge equals the Shopify draft total, never a number sent by the browser.']),
      bullet([{ text: 'Webhook signature: ', bold: true }, 'the webhook is HMAC-SHA256 verified with the secret key — a forged webhook is rejected (401).']),
      bullet([{ text: 'Secrets stay server-side: ', bold: true }, 'Cashfree secret + Shopify Admin keys live only in server environment variables, never in browser code.']),

      H1('10. The Global Checkout (Shopify Hosted)'),
      P('International customers never touch our custom checkout. We simply hand them Shopify’s own checkout URL, and Shopify does payment, tax, and order creation itself — the standard, battle-tested Shopify flow. No custom payment code, and Global payments (Shopify Payments/Stripe) support automatic refunds.'),
      imgGchk, caption('Figure 5 — The Global store uses Shopify’s hosted checkout; nothing custom.'),

      new Paragraph({ children: [new PageBreak()] }),
      H1('11. Webhooks — How Cashfree and Shopify Call Us'),
      P('A webhook is a server-to-server phone call: an external service POSTs data to a URL on our server when something happens. We use two families of webhooks.'),
      H3('Cashfree payment webhook (api/webhooks/cashfree.ts)'),
      P('Cashfree calls this URL when a payment succeeds. We read the RAW request body, verify the HMAC-SHA256 signature (timestamp + body, keyed with the secret), and only then complete the order. It must be registered in the Cashfree dashboard and must be a public HTTPS URL — the earlier bug was that the notify URL was pointing at localhost, which Cashfree can’t reach.'),
      codeBlock('signature = Base64( HMAC_SHA256( timestamp + rawBody, CASHFREE_SECRET_KEY ) )\nif (signature !== header “x-webhook-signature”)  ->  reject (401)'),
      H3('Shopify order webhooks (WhatsApp)'),
      P('Shopify calls a Supabase Edge Function whenever an order is created, fulfilled, cancelled, or refunded. That function verifies Shopify’s HMAC signature, maps the event to a WhatsApp template, and sends the message via Meta’s WhatsApp Cloud API. This lives in a separate whatsapp/ project (Supabase), not in the website repo.'),
      table(['Shopify event', 'WhatsApp message'], [
        ['orders/create (prepaid)', 'order_confirmed'],
        ['orders/create (COD)', 'cod_confirmation'],
        ['orders/fulfilled', 'order_shipped (with tracking link)'],
        ['orders/cancelled', 'order_cancelled'],
        ['refunds/create', 'refund_processed'],
      ], [50, 50]),

      H1('12. Order Lifecycle'),
      P('An order moves through a clear set of states, from a shopping cart to a delivered package — with a cancel branch available before it ships.'),
      imgState, caption('Figure 6 — The order lifecycle, including the pre-shipment cancel branch.'),

      new Paragraph({ children: [new PageBreak()] }),
      H1('13. Customer Accounts'),
      P('Accounts use Firebase Google sign-in. There are no passwords — the customer signs in with Google, and we match them to their Shopify orders by their verified email.'),
      H3('How login is trusted on the server'),
      P([{ text: 'firebaseClient.ts', font: MONO }, ' (browser) signs the user in and produces an ID token. Every account API call sends this token. ', { text: 'firebaseAuth.ts', font: MONO }, ' (server) verifies it with the ', { text: 'jose', font: MONO }, ' library against Google’s public keys — checking the token was issued for our Firebase project — and extracts the trusted email. Only that email can see that customer’s orders.']),
      table(['Feature', 'File(s)', 'How it works'], [
        ['Sign-in + profile', 'AccountPage.astro, firebaseClient.ts', 'Google sign-in; saved address stored in Firestore.'],
        ['Order history', 'api/account/orders.ts + admin.ts', 'Verified email -> Shopify orders by email.'],
        ['Order detail + tracking', 'account/orders/[id].astro', 'Timeline, items, price summary, address.'],
        ['Cancel order', 'api/account/cancel-order.ts', 'Only before shipping; restocks; flags prepaid for refund.'],
        ['Request a return', 'api/account/return-request.ts', 'Tags the Shopify order for the team.'],
        ['Buy it again', 'account/orders/[id].astro', 'Re-adds the order’s items to the cart.'],
      ], [22, 34, 44]),

      H1('14. Security Summary'),
      bullet([{ text: 'Never trust the browser ', bold: true }, '— payment status, prices, and order completion are all decided server-side.']),
      bullet([{ text: 'Secrets are server-only ', bold: true }, '— Cashfree secret, Shopify Admin keys, and the Firebase project id live in Vercel environment variables.']),
      bullet([{ text: 'Signed webhooks ', bold: true }, '— both Cashfree and Shopify webhooks are HMAC-verified; forgeries are rejected.']),
      bullet([{ text: 'Verified logins ', bold: true }, '— Firebase tokens are cryptographically verified before any order data is shown.']),
      bullet([{ text: 'Idempotent order creation ', bold: true }, '— duplicate confirmations can never create duplicate orders.']),
      bullet([{ text: 'Action needed: ', bold: true, color: CHERRY }, 'rotate any keys that were shared in plaintext (Cashfree secret, Shopify Admin) and keep them only in Vercel.']),

      H1('15. Deployment & Environment'),
      P('The app is hosted on Vercel. Pushing to the main branch on GitHub auto-deploys. Each API route becomes its own serverless function; a daily Vercel cron triggers the reconciler.'),
      table(['Environment variable', 'Used for'], [
        ['SHOPIFY_IN_DOMAIN / _TOKEN', 'India Storefront (products, cart).'],
        ['SHOPIFY_GLOBAL_DOMAIN / _TOKEN', 'Global Storefront.'],
        ['SHOPIFY_IN_ADMIN_DOMAIN / _CLIENT_ID / _CLIENT_SECRET', 'India Admin API (orders).'],
        ['CASHFREE_APP_ID / _SECRET_KEY / _ENV', 'Cashfree payments + webhook signature.'],
        ['PUBLIC_CASHFREE_MODE', 'sandbox vs production (client SDK).'],
        ['PUBLIC_FIREBASE_* (x4)', 'Firebase accounts.'],
        ['PUBLIC_APP_ORIGIN', 'Guarantees the payment callback uses the real domain (not localhost).'],
        ['CRON_SECRET', 'Secures the reconciler cron endpoint.'],
      ], [46, 54]),

      new Paragraph({ children: [new PageBreak()] }),
      H1('16. File-by-File Reference'),
      H3('Server logic (src/lib)'),
      table(['File', 'Does what'], [
        ['markets.ts', 'Market table, store credentials, geo/locale helpers.'],
        ['cart-session.ts', 'Cart ids in cookies (main + buy-now, per store).'],
        ['cashfree.ts', 'Cashfree create/get order, signature verify, finalizeOrder.'],
        ['firebaseClient.ts', 'Browser Firebase: sign-in, ID token, Firestore profile.'],
        ['firebaseAuth.ts', 'Server: verify Firebase ID token (jose + Google JWKS).'],
        ['shopify/client.ts', 'Storefront GraphQL client + runQuery.'],
        ['shopify/queries.ts', 'Product/collection queries.'],
        ['shopify/cart.ts', 'Storefront cart operations.'],
        ['shopify/admin.ts', 'India Admin API: drafts, orders, cancel, reconcile.'],
        ['india-locations.ts', 'India states/cities for the address form.'],
      ], [30, 70]),
      H3('API routes (src/pages/api)'),
      table(['Route', 'Does what'], [
        ['checkout/create.ts', 'Creates the order + Cashfree session (or completes COD).'],
        ['checkout/buynow.ts', 'Express single-item checkout.'],
        ['checkout/apply-discount.ts', 'Applies a coupon to the checkout total.'],
        ['webhooks/cashfree.ts', 'Cashfree payment webhook (verify + complete).'],
        ['cron/reconcile-orders.ts', 'Daily safety-net sweep for paid-but-uncompleted orders.'],
        ['cart/add | remove | update | index', 'Cart operations from the browser.'],
        ['cart/apply-discount.ts', 'Coupon on the cart.'],
        ['account/orders.ts', 'Order history for the signed-in customer.'],
        ['account/cancel-order.ts', 'Cancel an unshipped order.'],
        ['account/return-request.ts', 'Request a return.'],
      ], [34, 66]),
      H3('Pages that run server code (src/pages)'),
      table(['Page', 'Does what'], [
        ['checkout.astro / CheckoutPage.astro', 'The India checkout UI + payment.'],
        ['checkout/return.astro', 'Verifies Cashfree payment, shows result, completes order.'],
        ['account.astro / AccountPage.astro', 'Sign-in + profile + order list.'],
        ['account/orders/[id].astro', 'Order Summary (timeline, items, cancel, reorder).'],
        ['products/[handle].astro', 'Product detail page.'],
        ['index / shop / cart', 'Home, shop grid, cart.'],
      ], [40, 60]),

      new Paragraph({ spacing: { before: 300 }, children: [new TextRun({ text: 'End of document — Mir Kash technical documentation.', font: FONT, italics: true, size: 18, color: MID })] }),
    ],
  }],
});

const buffer = await Packer.toBuffer(doc);
const out = join(homedir(), 'Desktop', 'Mir-Kash-Technical-Documentation.docx');
writeFileSync(out, buffer);
console.log('WROTE:', out, '(' + Math.round(buffer.length / 1024) + ' KB)');
