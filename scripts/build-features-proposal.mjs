// Generates "Mir-Kash-New-Features-Proposal.docx" — a visual, plain-language
// proposal (coupons, accounts, order history, returns, optional OTP) for BOTH
// the India and Global stores, with embedded flow diagrams.
// Run: node scripts/build-features-proposal.mjs
import {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
  ImageRun, Table, TableRow, TableCell, WidthType, BorderStyle,
} from 'docx';
import sharp from 'sharp';
import { writeFileSync, copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

// ── Brand ──────────────────────────────────────────────────────────────────
const CHERRY = '8B1A1A', INK = '2C1A0E', MID = '6E6A64', GREEN = '2F6B3F';
const FONT = 'Calibri';
const C = { cherry: '#8B1A1A', ink: '#2C1A0E', paper: '#FBF9F5', rule: '#E4DFD7', mid: '#8a857d', green: '#2f6b3f', soft: '#F3EFE8' };

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
function wrap(text, max) {
  const words = String(text).split(' ');
  const lines = []; let cur = '';
  for (const w of words) {
    if ((cur + ' ' + w).trim().length > max) { if (cur) lines.push(cur); cur = w; }
    else cur = (cur + ' ' + w).trim();
  }
  if (cur) lines.push(cur);
  return lines;
}

// ── Vertical flow diagram (legible in a document) ────────────────────────────
function flowSvg(steps, opts = {}) {
  const accent = new Set(opts.accent || []);
  const done = new Set(opts.done || []);
  const bw = 540, bh = 70, gap = 34, mx = 18, my = 18;
  const W = bw + mx * 2, n = steps.length;
  const H = my * 2 + n * bh + (n - 1) * gap;
  let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`;
  s += `<rect width="${W}" height="${H}" fill="${C.paper}"/>`;
  s += `<defs><marker id="ah" markerWidth="12" markerHeight="12" refX="4" refY="5" orient="auto"><path d="M0,0 L8,5 L0,10 Z" fill="${C.mid}"/></marker></defs>`;
  steps.forEach((step, i) => {
    const x = mx, y = my + i * (bh + gap);
    const isA = accent.has(i), isD = done.has(i);
    const fill = isA ? C.cherry : (isD ? '#EAF3EC' : '#ffffff');
    const stroke = isA ? C.cherry : (isD ? C.green : C.ink);
    const txt = isA ? '#ffffff' : C.ink;
    s += `<rect x="${x}" y="${y}" width="${bw}" height="${bh}" rx="9" fill="${fill}" stroke="${stroke}" stroke-width="1.6"/>`;
    const bx = x + 34, by = y + bh / 2;
    s += `<circle cx="${bx}" cy="${by}" r="15" fill="${isA ? '#ffffff' : C.cherry}"/>`;
    s += `<text x="${bx}" y="${by + 5}" font-family="Arial" font-size="15" font-weight="700" fill="${isA ? C.cherry : '#ffffff'}" text-anchor="middle">${i + 1}</text>`;
    const lines = wrap(step, 52), lh = 19;
    const startY = by - (lines.length - 1) * lh / 2 + 5;
    lines.forEach((ln, li) => {
      s += `<text x="${x + 66}" y="${startY + li * lh}" font-family="Arial" font-size="15.5" fill="${txt}" text-anchor="start">${esc(ln)}</text>`;
    });
    if (i < n - 1) {
      const cx = W / 2, y1 = y + bh + 4, y2 = y + bh + gap - 4;
      s += `<line x1="${cx}" y1="${y1}" x2="${cx}" y2="${y2 - 4}" stroke="${C.mid}" stroke-width="2.4" marker-end="url(#ah)"/>`;
    }
  });
  s += `</svg>`;
  return { svg: s, W, H };
}

// ── Both-stores architecture picture ─────────────────────────────────────────
function archSvg() {
  const W = 900, H = 600;
  const box = (x, y, w, h, label, sub, fill, stroke, txt) => {
    let g = `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="10" fill="${fill}" stroke="${stroke}" stroke-width="1.8"/>`;
    const lines = wrap(label, 26), lh = 20;
    const totalH = lines.length * lh + (sub ? 18 : 0);
    let sy = y + h / 2 - totalH / 2 + 16;
    lines.forEach((ln) => { g += `<text x="${x + w / 2}" y="${sy}" font-family="Arial" font-size="16" font-weight="700" fill="${txt}" text-anchor="middle">${esc(ln)}</text>`; sy += lh; });
    if (sub) g += `<text x="${x + w / 2}" y="${sy + 2}" font-family="Arial" font-size="13" fill="${txt}" text-anchor="middle">${esc(sub)}</text>`;
    return g;
  };
  const arrow = (x1, y1, x2, y2, dash) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${C.mid}" stroke-width="2.2" ${dash ? 'stroke-dasharray="6 5"' : ''} marker-end="url(#ah)"/>`;
  let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`;
  s += `<rect width="${W}" height="${H}" fill="${C.paper}"/>`;
  s += `<defs><marker id="ah" markerWidth="12" markerHeight="12" refX="4" refY="5" orient="auto"><path d="M0,0 L8,5 L0,10 Z" fill="${C.mid}"/></marker></defs>`;
  // Customer
  s += box(330, 24, 240, 64, 'Customer on mirkash.com', null, '#ffffff', C.ink, C.ink);
  s += arrow(450, 88, 450, 120);
  // split lines
  s += `<line x1="450" y1="120" x2="230" y2="120" stroke="${C.mid}" stroke-width="2.2"/>`;
  s += `<line x1="450" y1="120" x2="670" y2="120" stroke="${C.mid}" stroke-width="2.2"/>`;
  s += arrow(230, 120, 230, 150);
  s += arrow(670, 120, 670, 150);
  // India column
  s += box(70, 152, 320, 60, 'INDIA store (Shopify)', 'shown at mirkash.com root', '#FCEFEF', C.cherry, C.ink);
  s += arrow(230, 212, 230, 240);
  s += box(70, 242, 320, 66, 'Custom checkout', 'OTP (optional) · Coupons · Address', '#ffffff', C.ink, C.ink);
  s += arrow(230, 308, 230, 336);
  s += box(70, 338, 320, 60, 'Cashfree payment', 'UPI · Cards · Netbanking (₹)', '#ffffff', C.ink, C.ink);
  // Global column
  s += box(510, 152, 320, 60, 'GLOBAL store (Shopify)', 'shown at /en-us, /en-gb …', '#EEF3FB', '#2c4a7a', C.ink);
  s += arrow(670, 212, 670, 240);
  s += box(510, 242, 320, 66, 'Shopify checkout', 'Coupons · local currency', '#ffffff', C.ink, C.ink);
  // Orders land in Shopify (both)
  s += box(255, 430, 390, 60, 'Orders stored in Shopify', 'paid orders + draft (abandoned) + customers', '#ffffff', C.ink, C.ink);
  s += arrow(230, 398, 360, 430, false);
  s += arrow(670, 308, 540, 430, false);
  // My account reads both
  s += box(255, 516, 390, 60, 'My Account (phone login)', 'order history · returns — reads from Shopify', '#EAF3EC', C.green, C.ink);
  s += arrow(450, 516, 450, 490);
  s += `</svg>`;
  return { svg: s, W, H };
}

// ── docx helpers ─────────────────────────────────────────────────────────────
const title = (t) => new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 40 }, children: [new TextRun({ text: t, bold: true, size: 40, color: INK, font: FONT })] });
const sub = (t) => new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 60 }, children: [new TextRun({ text: t, size: 21, color: MID, font: FONT })] });
const h1 = (t) => new Paragraph({ heading: HeadingLevel.HEADING_1, spacing: { before: 300, after: 80 }, children: [new TextRun({ text: t, bold: true, size: 30, color: CHERRY, font: FONT })] });
const h2 = (t) => new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { before: 220, after: 70 }, children: [new TextRun({ text: t, bold: true, size: 25, color: INK, font: FONT })] });
const p = (runs) => new Paragraph({ spacing: { after: 110, line: 288 }, children: Array.isArray(runs) ? runs : [new TextRun({ text: runs, size: 22, color: '262626', font: FONT })] });
const t = (text, o = {}) => new TextRun({ text, size: 22, color: o.color || '262626', bold: o.bold, italics: o.italics, font: FONT });
const bullet = (text) => new Paragraph({ bullet: { level: 0 }, spacing: { after: 60, line: 276 }, children: [new TextRun({ text, size: 21.5 * 2 / 2, color: '333333', font: FONT })] });
const caption = (text) => new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 200 }, children: [new TextRun({ text, italics: true, size: 18, color: MID, font: FONT })] });

async function imgPara(svgObj, displayW) {
  const buf = await sharp(Buffer.from(svgObj.svg), { density: 200 }).png().toBuffer();
  const height = Math.round(displayW * (svgObj.H / svgObj.W));
  return { para: new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 120, after: 60 }, children: [new ImageRun({ data: buf, type: 'png', transformation: { width: displayW, height } })] }), buf };
}

function infoTable(rows) {
  const cell = (text, head, w) => new TableCell({
    width: { size: w, type: WidthType.PERCENTAGE },
    shading: head ? { fill: 'F3EFE8' } : undefined,
    margins: { top: 80, bottom: 80, left: 120, right: 120 },
    children: [new Paragraph({ children: [new TextRun({ text, bold: head, size: 21, color: head ? INK : '333333', font: FONT })] })],
  });
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: { style: BorderStyle.SINGLE, size: 4, color: 'E4DFD7' }, bottom: { style: BorderStyle.SINGLE, size: 4, color: 'E4DFD7' },
      left: { style: BorderStyle.SINGLE, size: 4, color: 'E4DFD7' }, right: { style: BorderStyle.SINGLE, size: 4, color: 'E4DFD7' },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 4, color: 'E4DFD7' }, insideVertical: { style: BorderStyle.SINGLE, size: 4, color: 'E4DFD7' },
    },
    rows: rows.map((r, i) => new TableRow({ children: [cell(r[0], i === 0, 32), cell(r[1], i === 0, 68)] })),
  });
}

// ── Build ────────────────────────────────────────────────────────────────────
const dumpDir = join(process.cwd(), 'scripts', '_diagrams');
if (!existsSync(dumpDir)) mkdirSync(dumpDir, { recursive: true });
const children = [];
async function addImg(svgObj, name, w = 560) {
  const { para, buf } = await imgPara(svgObj, w);
  writeFileSync(join(dumpDir, name + '.png'), buf);
  children.push(para);
}

children.push(title('Mir Kash — New Features Proposal'));
children.push(sub('Coupons · Customer Accounts · Order History · Returns · Optional OTP'));
children.push(sub('For BOTH the India and Global stores'));

children.push(h1('1.  Overview'));
children.push(p('This document proposes five customer-facing improvements for the Mir Kash website, covering both the India store (custom Cashfree checkout) and the Global store (Shopify checkout). Nothing here changes the products, the look of the storefront, or the existing payment flows — these are additions on top.'));
children.push(p([t('The thread connecting them is a new ', {}), t('“My Account” area', { bold: true }), t(' where customers log in with their phone number (OTP) to see their orders and request returns. The same login lets us make OTP ', {}), t('optional at checkout', { bold: true }), t(' — reducing purchase friction while keeping it useful.', {})]));
children.push(h2('How it all fits together'));
await addImg(archSvg(), 'architecture', 600);
children.push(caption('Both stores live under mirkash.com. Orders are stored in Shopify; the new Account area reads from there.'));

children.push(h1('2.  Coupons / Discount Codes'));
children.push(p('Today neither store lets a customer type a coupon code on our site. We will add a discount-code field on the cart/checkout for both stores.'));
await addImg(flowSvg([
  'Customer types a coupon code on the cart / checkout',
  'We check the code with Shopify (is it valid? how much off?)',
  'The discount is applied — the total updates instantly',
  'India: Cashfree charges the discounted amount · Global: discount carries into Shopify checkout',
], { accent: [2] }), 'coupons');
children.push(caption('Coupon flow — works for both stores; codes are managed in Shopify (Discounts).'));
children.push(infoTable([
  ['Area', 'Detail'],
  ['Both stores', 'One coupon field on the cart/checkout; discounts are created and controlled in Shopify Admin → Discounts.'],
  ['India', 'The custom checkout applies the discount to the order so Cashfree charges the correct, lower amount.'],
  ['Global', 'The discounted cart flows into Shopify’s own checkout — Shopify handles the rest.'],
]));

children.push(h1('3.  Customer Accounts & Login'));
children.push(p('A new “Account” link in the top menu opens a My Account page. Customers log in with their phone number and a one-time code (the same OTP technology already built). No passwords to remember, no separate sign-up.'));
await addImg(flowSvg([
  'Customer clicks “Account” in the menu',
  'Enters their phone number',
  'Receives a one-time code (OTP) by SMS and enters it',
  'Logged in — sees their orders and returns',
], { done: [3] }), 'account-login');
children.push(caption('Login flow — phone + OTP, same for India and Global customers.'));

children.push(h1('4.  Order History'));
children.push(p('Once logged in, customers see every order they have placed — pulled live from Shopify, across both stores — with status, items, amount and delivery progress. A customer can only ever see orders that belong to their own verified phone number.'));
await addImg(flowSvg([
  'Customer is logged in (phone verified)',
  'The site securely asks both Shopify stores for that customer’s orders',
  'Their orders are combined into one list',
  'Customer sees order history with status, items and totals',
]), 'order-history');
children.push(caption('Order history — read directly from Shopify; no separate database to maintain.'));

children.push(h1('5.  Returns'));
children.push(p('On a delivered order, the customer can press “Request a return”, choose a reason, and submit. The order is flagged in Shopify so your team can review and process the refund. (Fully automatic refunds are a possible later upgrade.)'));
await addImg(flowSvg([
  'Customer opens a delivered order in My Account',
  'Presses “Request a return” and picks a reason',
  'The order is flagged “return-requested” in Shopify, with the reason saved',
  'Your team reviews and approves the refund',
], { accent: [1] }), 'returns');
children.push(caption('Returns (version 1) — a request + review flow; you stay in control of refunds.'));

children.push(h1('6.  Optional OTP at Checkout'));
children.push(p([t('You felt the mandatory OTP at checkout adds friction. Because OTP now powers account login, we can ', {}), t('make it optional at checkout', { bold: true }), t(' — a customer can buy without verifying, or verify if they want their order linked to their account. Their phone number is still collected on the order either way.', {})]));

children.push(h1('7.  Rollout Plan'));
children.push(p('Each phase is useful on its own and can ship independently, lowest-risk first:'));
children.push(infoTable([
  ['Phase', 'What ships'],
  ['Phase 1', 'Coupons on both stores.'],
  ['Phase 2', 'My Account + phone login + order history (both stores).'],
  ['Phase 3', 'Returns (request + review).'],
  ['Phase 4', 'Make OTP optional at checkout.'],
]));

children.push(h1('8.  What We Need From You'));
children.push(p('Almost everything reuses what is already set up. The one new item:'));
children.push(bullet('A Global Shopify Admin API app (Client ID + Secret) — set up exactly like the India one we already did. This lets the Account area read Global orders and flag Global returns.'));
children.push(p([t('Already decided: ', { bold: true }), t('OTP at checkout → optional; account login → phone + OTP (no passwords); returns → request-and-review first. Customer data stays in Shopify (no new database).', {})]));

children.push(new Paragraph({ spacing: { before: 260 }, alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'Prepared for review — nothing is built yet. Approve the direction and we implement phase by phase.', italics: true, size: 19, color: MID, font: FONT })] }));

const doc = new Document({
  creator: 'Mir Kash', title: 'Mir Kash — New Features Proposal',
  styles: { default: { document: { run: { font: FONT, size: 22 } } } },
  sections: [{ properties: { page: { margin: { top: 900, bottom: 900, left: 1000, right: 1000 } } }, children }],
});

const buf = await Packer.toBuffer(doc);
const out = join(process.cwd(), 'Mir-Kash-New-Features-Proposal.docx');
writeFileSync(out, buf);
console.log('Wrote', out);
const desktop = join(homedir(), 'OneDrive', 'Desktop');
if (existsSync(desktop)) { const dst = join(desktop, 'Mir-Kash-New-Features-Proposal.docx'); copyFileSync(out, dst); console.log('Copied to', dst); }
console.log('Diagram PNGs in', dumpDir);
