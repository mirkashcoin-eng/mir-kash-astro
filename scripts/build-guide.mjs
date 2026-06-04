// Generates "Mir-Kash-Phase2-Guide.docx" — a business + technical explainer for the
// Product, Cart, and Checkout pages, with diagrams rendered from Mermaid (via mermaid.ink,
// falling back to kroki.io). Run: node scripts/build-guide.mjs
import {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
  Table, TableRow, TableCell, WidthType, ImageRun, BorderStyle, ShadingType,
} from 'docx';
import { writeFileSync, copyFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import zlib from 'node:zlib';

const CHERRY = '8B1A1A';
const INK = '2C1A0E';
const MID = '6E6A64';

// ── Diagram rendering ────────────────────────────────────────────────────────
function pngSize(buf) {
  if (!buf || buf.length < 24) return { w: 600, h: 400 };
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

async function fetchBuf(url, opts) {
  const res = await fetch(url, opts);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

async function renderMermaid(code, name) {
  // 1) mermaid.ink (plain base64 of the diagram)
  try {
    const b64 = Buffer.from(code, 'utf8').toString('base64');
    const buf = await fetchBuf(`https://mermaid.ink/img/${b64}?type=png&bgColor=FFFFFF`);
    if (buf.slice(0, 8).toString('hex') === '89504e470d0a1a0a') {
      console.log(`  ✓ ${name} (mermaid.ink)`);
      return buf;
    }
    throw new Error('not a PNG');
  } catch (e) {
    console.log(`  … mermaid.ink failed for ${name} (${e.message}); trying kroki`);
  }
  // 2) kroki.io (zlib deflate + base64url)
  try {
    const enc = zlib.deflateSync(Buffer.from(code, 'utf8')).toString('base64url');
    const buf = await fetchBuf(`https://kroki.io/mermaid/png/${enc}`);
    console.log(`  ✓ ${name} (kroki.io)`);
    return buf;
  } catch (e) {
    console.log(`  ✗ ${name} could not be rendered (${e.message})`);
    return null;
  }
}

// ── docx helpers ─────────────────────────────────────────────────────────────
const FONT = 'Calibri';

function h1(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 320, after: 140 },
    children: [new TextRun({ text, bold: true, color: CHERRY, font: FONT, size: 32 })],
  });
}
function h2(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 240, after: 100 },
    children: [new TextRun({ text, bold: true, color: INK, font: FONT, size: 26 })],
  });
}
function p(text, opts = {}) {
  return new Paragraph({
    spacing: { after: 120, line: 276 },
    children: [new TextRun({ text, font: FONT, size: 22, color: opts.color || '222222', bold: !!opts.bold, italics: false })],
  });
}
function bullet(text) {
  return new Paragraph({
    bullet: { level: 0 },
    spacing: { after: 60, line: 268 },
    children: [new TextRun({ text, font: FONT, size: 22, color: '222222' })],
  });
}
function spacer() { return new Paragraph({ children: [], spacing: { after: 80 } }); }

function imagePara(buf, maxW = 600) {
  if (!buf) return p('[diagram unavailable — network blocked when generating]', { color: MID });
  const { w, h } = pngSize(buf);
  const scale = w > maxW ? maxW / w : 1;
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 120, after: 200 },
    children: [new ImageRun({ data: buf, type: 'png', transformation: { width: Math.round(w * scale), height: Math.round(h * scale) } })],
  });
}
function caption(text) {
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 220 },
    children: [new TextRun({ text, font: FONT, size: 18, italics: false, color: MID })],
  });
}

function cell(text, { bold = false, header = false, width } = {}) {
  return new TableCell({
    width: width ? { size: width, type: WidthType.PERCENTAGE } : undefined,
    shading: header ? { type: ShadingType.CLEAR, fill: 'F3EFE9' } : undefined,
    margins: { top: 60, bottom: 60, left: 100, right: 100 },
    children: [new Paragraph({ children: [new TextRun({ text, font: FONT, size: 20, bold: bold || header, color: header ? INK : '222222' })] })],
  });
}
function table(headers, rows, widths) {
  const border = { style: BorderStyle.SINGLE, size: 4, color: 'DDD6CC' };
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: { top: border, bottom: border, left: border, right: border, insideHorizontal: border, insideVertical: border },
    rows: [
      new TableRow({ tableHeader: true, children: headers.map((hd, i) => cell(hd, { header: true, width: widths?.[i] })) }),
      ...rows.map((r) => new TableRow({ children: r.map((c, i) => cell(c, { width: widths?.[i] })) })),
    ],
  });
}

// ── Diagrams ─────────────────────────────────────────────────────────────────
const diagrams = {
  architecture: `flowchart LR
  U["Shopper's browser"] -->|"requests page"| A["Mir Kash site<br/>(Astro, server-rendered on Vercel)"]
  A -->|"GraphQL: products & cart<br/>(secret token, server-side)"| S["Shopify Storefront API"]
  A -->|"HTML pages"| U
  U -->|"clicks Checkout"| C["Shopify Hosted Checkout<br/>(mirkash.in)"]
  C --> PG["Payment Gateway<br/>(set in Shopify Admin)"]
  PG --> O["Order created<br/>Shopify Admin → Orders"]`,

  journey: `flowchart TD
  H["Home / Shop"] --> P["Product page<br/>/products/handle"]
  P -->|"pick colour & size"| ATB["Add to Bag"]
  ATB --> CART["Cart page /cart"]
  CART -->|"Checkout"| HC["Shopify Hosted Checkout"]
  HC --> PAY["Enter address + pay"]
  PAY --> CONF["Order confirmation + email"]`,

  addToCart: `sequenceDiagram
  participant C as Shopper
  participant B as Product page (browser)
  participant API as /api/cart/add (our server)
  participant S as Shopify Storefront API
  C->>B: Click "Add to Bag"
  B->>API: POST { variantId, qty, market }
  API->>S: cartCreate / cartLinesAdd
  S-->>API: Cart (id, lines, totals, checkoutUrl)
  API-->>B: Cart JSON + set cart cookie
  B->>C: Redirect to /cart`,

  cartUpdate: `sequenceDiagram
  participant B as Cart page (browser)
  participant API as /api/cart/update or /remove
  participant S as Shopify Storefront API
  B->>API: POST { lineId, quantity, market }
  API->>S: cartLinesUpdate / cartLinesRemove
  S-->>API: Updated cart
  API-->>B: Cart JSON (+ updated cookie)
  B->>B: Reload — totals & count refresh`,

  checkout: `sequenceDiagram
  participant B as Cart page
  participant SC as Shopify Hosted Checkout
  participant PG as Payment Gateway
  participant BK as Bank / UPI
  participant SH as Shopify (Orders)
  B->>SC: Go to cart.checkoutUrl
  SC->>B: Secure checkout (address, shipping)
  B->>PG: Submit payment
  PG->>BK: Authorise charge
  BK-->>PG: Approved
  PG-->>SC: Payment confirmed
  SC->>SH: Create paid order
  SH-->>B: Thank-you page + email`,
};

// ── Build ────────────────────────────────────────────────────────────────────
async function main() {
  console.log('Rendering diagrams…');
  const imgs = {};
  for (const [k, code] of Object.entries(diagrams)) imgs[k] = await renderMermaid(code, k);

  const children = [];

  // Title
  children.push(new Paragraph({
    alignment: AlignmentType.CENTER, spacing: { before: 600, after: 80 },
    children: [new TextRun({ text: 'MIR KASH', font: FONT, size: 56, bold: true, color: INK, characterSpacing: 60 })],
  }));
  children.push(new Paragraph({
    alignment: AlignmentType.CENTER, spacing: { after: 60 },
    children: [new TextRun({ text: 'Phase 2 — Product, Cart & Checkout', font: FONT, size: 30, color: CHERRY })],
  }));
  children.push(new Paragraph({
    alignment: AlignmentType.CENTER, spacing: { after: 400 },
    children: [new TextRun({ text: 'How it works — a business + technical guide', font: FONT, size: 22, color: MID })],
  }));

  // 1. Overview
  children.push(h1('1. Overview'));
  children.push(p('We added three things to the Mir Kash website so customers can actually shop and buy: a Product page (to view a bag and choose options), a Cart page (the bag/basket), and a Checkout step. The site is built with Astro and runs on Vercel. All product and cart information comes from Shopify through its official Storefront API. When a customer is ready to pay, we hand them over to Shopify\'s own secure checkout — so payments are handled entirely by Shopify, not by our website.'));
  children.push(p('In one line: our site shows the products and manages the bag; Shopify stores the catalogue, runs the secure checkout, and records the order.'));

  // 2. Pages at a glance
  children.push(h1('2. The three pages at a glance'));
  children.push(table(
    ['Page', 'Address (URL)', 'What it does', 'Key file'],
    [
      ['Product', '/products/<bag-name>', 'Photos, colour & size selection, price, Add to Bag', 'ProductPage.astro'],
      ['Cart', '/cart', 'Lists chosen items, change quantity, remove, see total, Checkout button', 'CartPage.astro'],
      ['Checkout', 'Shopify-hosted (mirkash.in)', 'Address, shipping, payment, order creation', '(Shopify) via checkoutUrl'],
    ],
    [12, 30, 40, 18],
  ));
  children.push(spacer());

  // 3. Architecture
  children.push(h1('3. How the pieces fit together'));
  children.push(p('Our website never sees anyone\'s card details. We talk to Shopify behind the scenes to read products and build the bag; the moment money is involved, the customer is on Shopify\'s secure checkout.'));
  children.push(imagePara(imgs.architecture));
  children.push(caption('Figure 1 — System architecture'));
  children.push(p('The customer\'s journey from browsing to a confirmed order:'));
  children.push(imagePara(imgs.journey));
  children.push(caption('Figure 2 — Customer journey'));

  // 4. Product page
  children.push(h1('4. The Product page'));
  children.push(p('Business view: the shopper opens a bag, swipes/scrolls the photos, picks a colour and a size, sees the live price, and clicks “Add to Bag”. If a combination is out of stock the button shows “Sold Out”.'));
  children.push(p('Technical view:', { bold: true }));
  children.push(bullet('When the page loads, our server asks Shopify for that product by its “handle” (the name in the URL) using getProductByHandle — pulling images, colours, sizes, variants and prices.'));
  children.push(bullet('Each colour+size combination is a Shopify “variant” with its own ID, price and stock. The page knows every combination and, as the shopper selects options, it resolves the exact variant, updates the price, and enables/disables the button.'));
  children.push(bullet('“Add to Bag” sends that variant ID to our server endpoint /api/cart/add, then takes the shopper to the Cart.'));

  // 5. Cart
  children.push(h1('5. How the Cart works'));
  children.push(p('Business view: the cart is the shopper\'s bag. They can change quantities, remove items, and see the subtotal and total. A bag-count badge in the header shows how many items are in the bag. Nothing is charged here — Checkout sends them to Shopify to pay.'));
  children.push(p('Technical view — adding an item:', { bold: true }));
  children.push(imagePara(imgs.addToCart));
  children.push(caption('Figure 3 — Add to Bag'));
  children.push(p('Technical view — changing quantity or removing:', { bold: true }));
  children.push(imagePara(imgs.cartUpdate));
  children.push(caption('Figure 4 — Update / remove'));
  children.push(p('Key points about how the bag is remembered:', { bold: true }));
  children.push(bullet('The real cart lives in Shopify. We create it via the Storefront API and Shopify gives us a cart ID plus a checkout link.'));
  children.push(bullet('We store only that cart ID in a secure browser cookie (mk_cart_<market>), so the bag persists if the shopper leaves and comes back. A small count cookie powers the header badge.'));
  children.push(bullet('All cart changes go through our own server endpoints (/api/cart/add, /update, /remove, and a read endpoint). This keeps the secret Shopify token on the server, never in the browser.'));

  // 6. Checkout & payments
  children.push(h1('6. Checkout & Payments'));
  children.push(p('When the shopper clicks Checkout, we send them to the cart\'s Shopify checkout link (checkoutUrl). From there Shopify handles address, shipping, taxes, payment, and creating the order.'));
  children.push(imagePara(imgs.checkout));
  children.push(caption('Figure 5 — Checkout & payment'));
  children.push(h2('Which payment gateway?'));
  children.push(p('We do not build or choose the gateway in code — Shopify\'s hosted checkout uses whatever payment provider is enabled in your Shopify Admin (Settings → Payments). For the India store (mirkash.in, charging INR), Shopify Payments is not available in India, so it is typically a provider such as Razorpay, PayU, Cashfree, or similar (with cards, UPI, net-banking, wallets). The exact provider is whatever you have connected in Shopify Admin — please confirm there.'));
  children.push(h2('Is it a real order / real money?'));
  children.push(bullet('If the store is live with a real payment provider connected, a completed checkout is a REAL paid order: money is charged, the order appears in Shopify Admin → Orders, stock decreases, and confirmation emails are sent.'));
  children.push(bullet('To test safely without real charges: turn on test mode in Shopify Payments (or use the Bogus/test gateway), or place a real order and refund it, or use a 100%-off discount code.'));
  children.push(bullet('Card details never touch our website — Shopify is fully responsible for payment security (PCI compliance).'));

  // 7. Markets
  children.push(h1('7. Two markets (India & International)'));
  children.push(table(
    ['Market', 'URL', 'Currency', 'Checkout'],
    [
      ['India', 'mirkash.in (root)', 'INR ₹', 'India Shopify store checkout'],
      ['International / US', '/en-us', 'USD $', 'Global Shopify store checkout'],
    ],
    [22, 30, 18, 30],
  ));
  children.push(spacer());
  children.push(p('Each market has its own Shopify store and its own checkout. The site detects the market and the cart/checkout automatically use the right store and currency.'));

  // 8. Security
  children.push(h1('8. Security & data'));
  children.push(bullet('The secret Shopify access token stays on our server only; the browser never sees it.'));
  children.push(bullet('The cart ID is kept in a secure, HTTP-only cookie (not readable by page scripts).'));
  children.push(bullet('Because payment happens on Shopify\'s hosted checkout, no card data ever passes through our site — Shopify carries the PCI responsibility.'));

  // 9. File reference
  children.push(h1('9. Code reference (for developers)'));
  children.push(table(
    ['File', 'Role'],
    [
      ['src/components/ProductPage.astro', 'Product page UI + add-to-bag logic'],
      ['src/components/CartPage.astro', 'Cart page UI + qty/remove + checkout button'],
      ['src/lib/shopify/queries.ts', 'getProductByHandle, product/collection queries'],
      ['src/lib/shopify/cart.ts', 'Shopify cart mutations (create/add/update/remove/get)'],
      ['src/lib/shopify/fragments.ts', 'GraphQL fragments (product, cart, money, image)'],
      ['src/lib/cart-session.ts', 'Cart cookie helpers (id + count, per market)'],
      ['src/pages/api/cart/*.ts', 'Server endpoints: add, update, remove, get cart'],
      ['src/pages/products/[handle].astro', 'Product route (+ /en-us version)'],
      ['src/pages/cart.astro', 'Cart route (+ /en-us version)'],
    ],
    [40, 60],
  ));
  children.push(spacer());

  // 10. FAQ
  children.push(h1('10. Quick FAQ'));
  children.push(p('Where do orders show up?', { bold: true }));
  children.push(p('In your Shopify Admin → Orders, exactly like any Shopify order.'));
  children.push(p('Can we change the checkout look?', { bold: true }));
  children.push(p('The hosted checkout is styled in Shopify (Settings → Checkout / branding). The custom “Checkout-Express” design was intentionally not built, since real payments require Shopify\'s secure checkout.'));
  children.push(p('What if a cart link expires?', { bold: true }));
  children.push(p('If Shopify no longer recognises a stored cart, the next “Add to Bag” simply starts a fresh cart automatically.'));

  const doc = new Document({
    creator: 'Mir Kash', title: 'Mir Kash — Phase 2 Guide',
    styles: { default: { document: { run: { font: FONT, size: 22 } } } },
    sections: [{ children }],
  });

  const buf = await Packer.toBuffer(doc);
  const out = join(process.cwd(), 'Mir-Kash-Phase2-Guide.docx');
  writeFileSync(out, buf);
  console.log('Wrote', out);

  // Copy to Desktop for easy access
  const desktop = join(homedir(), 'OneDrive', 'Desktop');
  const target = existsSync(desktop) ? join(desktop, 'Mir-Kash-Phase2-Guide.docx') : null;
  if (target) { copyFileSync(out, target); console.log('Copied to', target); }
}

main().catch((e) => { console.error(e); process.exit(1); });
