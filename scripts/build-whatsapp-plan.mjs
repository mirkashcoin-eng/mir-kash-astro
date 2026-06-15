// Generates "Mir-Kash-WhatsApp-Plan.docx" — the COMPLETE self-build plan we will
// follow: WhatsApp order notifications + FAQ bot + team inbox, built on Supabase +
// Meta WhatsApp Cloud API (India store first). Plain language, with flow diagrams,
// an architecture diagram, a phased roadmap, data-model + cost tables.
// Document only — changes nothing in the website.
// Run: node scripts/build-whatsapp-plan.mjs
import {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
  ImageRun, Table, TableRow, TableCell, WidthType, BorderStyle,
} from 'docx';
import sharp from 'sharp';
import { writeFileSync, copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

// ── Brand ──────────────────────────────────────────────────────────────────
const CHERRY = '8B1A1A', INK = '2C1A0E', MID = '6E6A64', GREEN = '2F6B3F', BLUE = '2c4a7a';
const FONT = 'Calibri';
const C = { cherry: '#8B1A1A', ink: '#2C1A0E', paper: '#FBF9F5', rule: '#E4DFD7', mid: '#8a857d', green: '#2f6b3f', blue: '#2c4a7a', wa: '#1f8f4e', soft: '#F3EFE8' };

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

// ── Vertical flow diagram ────────────────────────────────────────────────────
function flowSvg(steps, opts = {}) {
  const accent = new Set(opts.accent || []);
  const done = new Set(opts.done || []);
  const bw = 540, bh = 76, gap = 32, mx = 18, my = 18;
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
    const lines = wrap(step, 50), lh = 19;
    const startY = by - (lines.length - 1) * lh / 2 + 5;
    lines.forEach((ln, li) => {
      s += `<text x="${x + 66}" y="${startY + li * lh}" font-family="Arial" font-size="15" fill="${txt}" text-anchor="start">${esc(ln)}</text>`;
    });
    if (i < n - 1) {
      const cx = W / 2, y1 = y + bh + 4, y2 = y + bh + gap - 4;
      s += `<line x1="${cx}" y1="${y1}" x2="${cx}" y2="${y2 - 4}" stroke="${C.mid}" stroke-width="2.4" marker-end="url(#ah)"/>`;
    }
  });
  s += `</svg>`;
  return { svg: s, W, H };
}

// ── shared box / arrow helpers for the architecture diagram ──────────────────
function boxFn(s) {
  return (x, y, w, h, label, sub, fill, stroke, txt, lblSize = 16, subSize = 11.5) => {
    let g = `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="10" fill="${fill}" stroke="${stroke}" stroke-width="1.8"/>`;
    const lines = wrap(label, 24), lh = lblSize + 4;
    const totalH = lines.length * lh + (sub ? subSize + 5 : 0);
    let sy = y + h / 2 - totalH / 2 + lblSize;
    lines.forEach((ln) => { g += `<text x="${x + w / 2}" y="${sy}" font-family="Arial" font-size="${lblSize}" font-weight="700" fill="${txt}" text-anchor="middle">${esc(ln)}</text>`; sy += lh; });
    if (sub) g += `<text x="${x + w / 2}" y="${sy + 1}" font-family="Arial" font-size="${subSize}" fill="${txt}" text-anchor="middle">${esc(sub)}</text>`;
    return g;
  };
}
const arrowFn = () => (x1, y1, x2, y2) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${C.mid}" stroke-width="2.4" marker-end="url(#ah)"/>`;
const lblFn = () => (x, y, text, color, anchor) => `<text x="${x}" y="${y}" font-family="Arial" font-size="12" font-weight="700" fill="${color || C.mid}" text-anchor="${anchor || 'middle'}">${esc(text)}</text>`;

// ── Self-build architecture: Customer ↔ Meta ↔ Supabase, + Shopify + Inbox ───
function archSvg() {
  const W = 980, H = 720;
  const box = boxFn();
  const arrow = arrowFn();
  const lbl = lblFn();
  let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`;
  s += `<rect width="${W}" height="${H}" fill="${C.paper}"/>`;
  s += `<defs><marker id="ah" markerWidth="12" markerHeight="12" refX="4" refY="5" orient="auto"><path d="M0,0 L8,5 L0,10 Z" fill="${C.mid}"/></marker></defs>`;

  // Customer (top)
  s += box(380, 24, 220, 70, 'Customer on WhatsApp', 'their phone', '#EAF7EF', C.green, C.ink);
  // Meta (gateway)
  s += box(355, 150, 270, 64, 'Meta WhatsApp Cloud API', 'the WhatsApp gateway + templates', '#EFF3FB', C.blue, C.ink, 15.5, 11);
  // Supabase container
  s += `<rect x="300" y="290" width="380" height="200" rx="12" fill="#ffffff" stroke="${C.cherry}" stroke-width="2"/>`;
  s += `<text x="490" y="316" font-family="Arial" font-size="17" font-weight="700" fill="${C.cherry}" text-anchor="middle">Supabase  (our backend)</text>`;
  // chips inside Supabase
  s += box(316, 330, 168, 56, 'shopify-webhook', 'outbound trigger', '#FCEFEF', C.cherry, C.ink, 13.5, 10.5);
  s += box(496, 330, 168, 56, 'whatsapp-webhook', 'inbound + bot', '#FCEFEF', C.cherry, C.ink, 13.5, 10.5);
  s += box(360, 404, 260, 56, 'Postgres database', 'config · logs · conversations', '#F3EFE8', C.ink, C.ink, 13.5, 10.5);
  // Shopify (left)
  s += box(30, 350, 220, 70, 'Shopify', 'India store (mirkash.in)', '#ffffff', C.ink, C.ink);
  // Team inbox (right)
  s += box(730, 350, 220, 70, 'Team Inbox', 'staff reply to humans', '#EAF3EC', C.green, C.ink);

  // Customer <-> Meta
  s += arrow(465, 148, 465, 96);   // up: outbound to customer
  s += lbl(402, 126, 'order updates', C.cherry);
  s += arrow(515, 96, 515, 148);   // down: inbound from customer
  s += lbl(560, 126, 'replies', C.green);
  // Meta <-> Supabase
  s += arrow(465, 288, 465, 216);  // up: send template
  s += lbl(402, 256, 'send template', C.blue);
  s += arrow(515, 216, 515, 288);  // down: inbound + status
  s += lbl(560, 256, 'inbound', C.green);
  // Shopify -> Supabase
  s += arrow(252, 372, 298, 372);
  s += lbl(275, 361, 'order events', C.ink);
  // Supabase <-> Team inbox
  s += arrow(682, 372, 728, 372);
  s += arrow(728, 392, 682, 392);
  s += lbl(705, 416, 'read + reply', C.green);

  // Legend
  s += `<rect x="300" y="540" width="380" height="150" rx="9" fill="#ffffff" stroke="${C.rule}" stroke-width="1.4"/>`;
  s += `<text x="490" y="566" font-family="Arial" font-size="13.5" font-weight="700" fill="${C.ink}" text-anchor="middle">How it works</text>`;
  const leg = [
    ['Outbound:', C.cherry, 'Shopify event → Supabase → Meta → customer'],
    ['Inbound:', C.green, 'customer → Meta → Supabase → bot reply'],
    ['Human:', C.blue, '“talk to a human” → Team Inbox → reply'],
    ['Storage:', C.ink, 'Supabase logs everything (replay + debug)'],
  ];
  leg.forEach((r, i) => {
    const y = 592 + i * 24;
    s += `<text x="320" y="${y}" font-family="Arial" font-size="12.5" font-weight="700" fill="${r[1]}" text-anchor="start">${esc(r[0])}</text>`;
    s += `<text x="392" y="${y}" font-family="Arial" font-size="12.5" fill="${C.ink}" text-anchor="start">${esc(r[2])}</text>`;
  });
  s += `</svg>`;
  return { svg: s, W, H };
}

// ── Both-stores: one system serves India + Global ───────────────────────────
function bothStoresSvg() {
  const W = 900, H = 340;
  const box = boxFn();
  const arrow = arrowFn();
  const lbl = lblFn();
  let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`;
  s += `<rect width="${W}" height="${H}" fill="${C.paper}"/>`;
  s += `<defs><marker id="ah" markerWidth="12" markerHeight="12" refX="4" refY="5" orient="auto"><path d="M0,0 L8,5 L0,10 Z" fill="${C.mid}"/></marker></defs>`;
  s += box(36, 54, 210, 76, 'India store', 'mirkash.in', '#FCEFEF', C.cherry, C.ink);
  s += box(36, 210, 210, 76, 'Global store', 'mirkash.com', '#EFF3FB', C.blue, C.ink);
  s += box(348, 122, 256, 96, 'Same Supabase system', 'detects the store, uses its own config', '#ffffff', C.ink, C.ink, 15.5, 11);
  s += box(700, 132, 180, 76, 'Meta -> customers', 'right number + template', '#EAF7EF', C.green, C.ink, 14.5, 10.5);
  s += arrow(248, 96, 346, 150);
  s += arrow(248, 248, 346, 192);
  s += lbl(298, 116, 'webhooks', C.ink);
  s += lbl(298, 236, 'webhooks', C.ink);
  s += arrow(606, 170, 698, 170);
  s += lbl(652, 160, 'send', C.green);
  s += `</svg>`;
  return { svg: s, W, H };
}

// ── docx helpers ─────────────────────────────────────────────────────────────
const title = (str) => new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 40 }, children: [new TextRun({ text: str, bold: true, size: 38, color: INK, font: FONT })] });
const sub = (str) => new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 60 }, children: [new TextRun({ text: str, size: 21, color: MID, font: FONT })] });
const h1 = (str) => new Paragraph({ heading: HeadingLevel.HEADING_1, spacing: { before: 300, after: 80 }, children: [new TextRun({ text: str, bold: true, size: 29, color: CHERRY, font: FONT })] });
const h2 = (str) => new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { before: 200, after: 60 }, children: [new TextRun({ text: str, bold: true, size: 24, color: INK, font: FONT })] });
const p = (runs) => new Paragraph({ spacing: { after: 110, line: 286 }, children: Array.isArray(runs) ? runs : [new TextRun({ text: runs, size: 22, color: '262626', font: FONT })] });
const t = (text, o = {}) => new TextRun({ text, size: 22, color: o.color || '262626', bold: o.bold, italics: o.italics, font: FONT });
const bullet = (text) => new Paragraph({ bullet: { level: 0 }, spacing: { after: 60, line: 276 }, children: [new TextRun({ text, size: 21, color: '333333', font: FONT })] });
const caption = (text) => new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 200 }, children: [new TextRun({ text, italics: true, size: 18, color: MID, font: FONT })] });

async function imgPara(svgObj, displayW) {
  const buf = await sharp(Buffer.from(svgObj.svg), { density: 200 }).png().toBuffer();
  const height = Math.round(displayW * (svgObj.H / svgObj.W));
  return { para: new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 120, after: 60 }, children: [new ImageRun({ data: buf, type: 'png', transformation: { width: displayW, height } })] }), buf };
}

function table(rows, widths) {
  const n = rows[0].length;
  const w = widths || Array(n).fill(Math.round(100 / n));
  const cell = (text, head, cw) => new TableCell({
    width: { size: cw, type: WidthType.PERCENTAGE },
    shading: head ? { fill: 'F3EFE8' } : undefined,
    margins: { top: 70, bottom: 70, left: 110, right: 110 },
    children: [new Paragraph({ children: [new TextRun({ text, bold: head, size: 20, color: head ? INK : '333333', font: FONT })] })],
  });
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: { style: BorderStyle.SINGLE, size: 4, color: 'E4DFD7' }, bottom: { style: BorderStyle.SINGLE, size: 4, color: 'E4DFD7' },
      left: { style: BorderStyle.SINGLE, size: 4, color: 'E4DFD7' }, right: { style: BorderStyle.SINGLE, size: 4, color: 'E4DFD7' },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 4, color: 'E4DFD7' }, insideVertical: { style: BorderStyle.SINGLE, size: 4, color: 'E4DFD7' },
    },
    rows: rows.map((r, i) => new TableRow({ children: r.map((c, j) => cell(c, i === 0, w[j])) })),
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

children.push(title('Mir Kash — WhatsApp System (Self-Build Plan)'));
children.push(sub('Order notifications + FAQ bot + team inbox · built on Supabase + Meta WhatsApp Cloud API'));
children.push(sub('India store (mirkash.in) first · the complete plan we will follow · nothing built yet'));

// 1. Overview
children.push(h1('1.  What we are building'));
children.push(p('We are building our own WhatsApp system for Mir Kash — instead of paying a third-party app. It does three things:'));
children.push(bullet('Outbound: automatically message customers when their order is placed, needs COD confirmation, or ships.'));
children.push(bullet('Inbound: a bot that answers common questions from a simple menu when a customer messages us.'));
children.push(bullet('Team inbox: when a customer wants a real person, the chat lands in a dashboard our staff can reply from.'));
children.push(p([t('We build it on ', {}), t('Supabase', { bold: true }), t(' (our backend + database). We start with the ', {}), t('India store only', { bold: true }), t('; the Global store can be added later. If Supabase proves awkward, the same design moves to Firebase, which the site already uses.', {})]));

children.push(h2('Important: Supabase alone cannot send WhatsApp'));
children.push(p([t('Only ', {}), t('Meta’s WhatsApp Cloud API', { bold: true }), t(' can actually deliver WhatsApp messages. Supabase is our “brain” that decides what to send and stores everything; Meta is the channel. So this is ', {}), t('Supabase + Meta', { bold: true }), t('. We still need a Meta WhatsApp Business account, a dedicated verified number, and Meta-approved message templates — that part is unavoidable in every approach.', {})]));

// 2. Architecture
children.push(h1('2.  How the whole system fits together'));
await addImg(archSvg(), 'arch', 600);
children.push(caption('Customer ↔ Meta ↔ Supabase. Shopify feeds order events in; the Team Inbox is where staff handle “talk to a human”. Supabase logs everything.'));

// 3. Why self-build
children.push(h1('3.  Why we chose to build it ourselves'));
children.push(p('A ready-made app (Interakt, AiSensy) would have been faster, but the team chose to own it. Here is the honest trade-off:'));
children.push(table([
  ['', 'Self-build (Supabase + Meta)', 'Ready-made app'],
  ['Monthly app fee', 'None (only pay Meta per message)', '~Rs 2,500 / month + Meta'],
  ['Control & data', 'Full — we own everything', 'Lives in their system'],
  ['Per-message cost at scale', 'Lowest (no markup)', 'Slightly higher'],
  ['Outbound notifications', 'We build it (easy)', 'Pre-built'],
  ['Inbound FAQ bot', 'We code the menu logic', 'No-code builder'],
  ['Team inbox', 'We build + host it', 'Included'],
  ['Ongoing upkeep', 'Ours to maintain', 'Vendor handles it'],
], [22, 40, 38]));
children.push(p([t('The trade is simple: ', {}), t('no monthly fee + full control + cheapest messages', { bold: true }), t(', in exchange for ', {}), t('building and maintaining it ourselves', { bold: true }), t('. Outbound is quick; the inbound bot and team inbox are the bulk of the work — which is why we build in phases (Section 9).', {})]));

// 4. Outbound
children.push(h1('4.  Outbound — the order messages'));
await addImg(flowSvg([
  'A customer places an order (or it ships) on the India Shopify store.',
  'Shopify sends the event to our Supabase function (which checks it is genuinely Shopify and not a duplicate).',
  'Supabase picks the matching approved template and asks Meta to send it.',
  'Meta delivers the WhatsApp message to the customer.',
], { accent: [2] }), 'outbound');
children.push(caption('Outbound flow — fully automatic. Works with the India Cashfree checkout because the order still lands in Shopify.'));
children.push(table([
  ['Message', 'When it sends'],
  ['Order confirmed', 'A prepaid order is placed.'],
  ['COD confirmation', 'A Cash-on-Delivery order is placed — asks the customer to confirm before dispatch.'],
  ['Order shipped', 'The order is fulfilled / handed to the courier (with tracking).'],
  ['Delivered / Cancelled / Refund', 'Added after the first three are proven.'],
], [30, 70]));

// 5. Inbound
children.push(h1('5.  Inbound — the FAQ bot'));
await addImg(flowSvg([
  'A customer messages the Mir Kash WhatsApp number.',
  'Meta forwards the message to our Supabase function.',
  'Our code reads the menu choice and sends the matching answer (Track order · Returns · Shipping).',
  'If they choose “talk to a human” (or we don’t understand), the chat is flagged for the Team Inbox.',
], { accent: [2] }), 'inbound');
children.push(caption('Inbound flow — the “flow builder” is logic we write in code (there is no visual builder when self-building).'));
children.push(table([
  ['Menu option', 'What the customer gets'],
  ['Track my order', 'A link / instructions to check their order status.'],
  ['Returns & exchanges', 'Our returns policy and how to start one.'],
  ['Shipping & delivery', 'Delivery timelines and shipping info.'],
  ['Talk to a human', 'Handed to the Team Inbox (within business hours).'],
], [30, 70]));

// 6. Team inbox
children.push(h1('6.  Team inbox + the 24-hour rule'));
children.push(p('The team inbox is a small dashboard where staff log in, see open conversations live, and reply. It is the part a paid app would have given us for free, so we build it ourselves.'));
await addImg(flowSvg([
  'A flagged conversation appears in the Team Inbox in real time.',
  'A staff member opens it and reads the full history.',
  'They type a reply; our backend sends it to the customer through Meta.',
  'The conversation is marked handled and logged.',
], { done: [3] }), 'inbox');
children.push(p([t('Meta’s 24-hour rule: ', { bold: true }), t('staff can send free-form replies only within 24 hours of the customer’s last message. Outside that window, only an approved template can be sent. The inbox shows whether the window is open.', {})]));

// 7. Data model
children.push(h1('7.  What Supabase stores (data model)'));
children.push(table([
  ['Table', 'Holds', 'Why it matters'],
  ['store_config', 'Per-store WhatsApp settings + secrets', 'One codebase serves India now, Global later'],
  ['template_map', 'Which template fits which event', 'Maps “order shipped” → the right message'],
  ['webhook_events', 'Raw Shopify events received', 'Replay + no duplicate messages (idempotency)'],
  ['messages_out', 'Every message we send + its status', 'Delivery tracking + debugging'],
  ['conversations', 'One row per customer chat + status', 'Powers the inbox (bot / needs agent / closed)'],
  ['messages', 'Each inbound + outbound chat line', 'Full conversation history'],
  ['agents', 'Staff who use the inbox', 'Login + who is handling what'],
], [22, 40, 38]));

// 8. The two functions + security
children.push(h1('8.  The two engine functions'));
children.push(table([
  ['Function', 'Runs when', 'What it does'],
  ['shopify-webhook', 'An order event happens in Shopify', 'Verify it is genuine → skip duplicates → pick template → send via Meta → log'],
  ['whatsapp-webhook', 'A customer messages, or a status arrives', 'Verify Meta signature → store message → bot reply or flag for inbox → update delivery status'],
], [26, 30, 44]));
children.push(h2('Security (non-negotiable)'));
children.push(bullet('Verify every Shopify webhook’s signature (HMAC) using the raw body — reject fakes.'));
children.push(bullet('Verify every Meta webhook with the verify token + signature.'));
children.push(bullet('Secrets (Meta token, Shopify secret, service key) live only on the server (Supabase secrets).'));
children.push(bullet('Skip duplicates using the Shopify event ID; never message blank or non-consented numbers; phone in +91 format.'));

// 9. The process / roadmap
children.push(h1('9.  How we will move (the process)'));
children.push(p('We build in three phases. Each phase is usable on its own, so value ships early and risk stays low.'));
await addImg(flowSvg([
  'Phase 1 — Outbound notifications: Meta number + templates + Supabase + the shopify-webhook + Shopify webhooks. Customers start getting order / COD / shipped messages.',
  'Phase 2 — Inbound FAQ bot: the whatsapp-webhook + Meta webhook + menu logic. Customers get instant menu answers.',
  'Phase 3 — Team inbox: staff login + live dashboard + reply path. “Talk to a human” goes live.',
], { accent: [0] }), 'roadmap');
children.push(caption('Rough effort: Phase 1 ≈ a few days · Phase 2 ≈ about a week · Phase 3 ≈ one to two weeks (the inbox is the biggest piece). Plus testing.'));

// 10. Serving both stores
children.push(h1('10.  Serving both stores (India + Global)'));
children.push(p('Good news: the SAME system serves both stores — it is multi-store by design. Every table carries a store tag, and a store_configs table holds each store’s own settings. One codebase, two stores.'));
await addImg(bothStoresSvg(), 'both-stores', 580);
children.push(caption('Both stores send their webhooks to the same system; it detects which store and uses that store’s own number, templates and language.'));
children.push(p('Each store’s webhooks hit the same function. It detects the store (from the Shopify shop-domain header), loads that store’s config, verifies with the right secret, and sends through the right number + template.'));
children.push(table([
  ['Per store', 'India (mirkash.in)', 'Global (mirkash.com)'],
  ['Shopify webhook secret', 'its own', 'its own'],
  ['Templates + language', 'English / Hindi, Rs amounts', 'English, local currency, own tone'],
  ['WhatsApp number', 'one shared number…', '…or a separate number (your choice)'],
], [28, 36, 36]));
children.push(h2('One number, or one per store?'));
children.push(bullet('One number for both — simplest and cheapest; every message comes from a single “Mir Kash” number.'));
children.push(bullet('A separate number per store — cleaner India-vs-international separation, with separate quality ratings and inboxes; more setup + cost.'));
children.push(bullet('Either way, Meta charges by the customer’s country (not the sender), so the per-message price is the same.'));
children.push(h2('Two things that differ by store'));
children.push(bullet('Opt-in: easy to add a checkbox on the India custom checkout; the Global store uses Shopify’s hosted checkout, so WhatsApp consent there is collected differently (Shopify settings / a checkout extension).'));
children.push(bullet('Both stores still produce normal Shopify order + fulfillment webhooks (India’s Cashfree order still lands in Shopify), so the trigger layer is identical.'));
children.push(p([t('Rollout: ', { bold: true }), t('we still build India first on this two-store foundation. Turning on Global later is mostly config + setup — add Global’s config row, approve its templates, register its Shopify webhooks, optionally add a second number, and sort out Global opt-in — not a rebuild.', {})]));

// 11. Setup runbook
children.push(h1('11.  Setup runbook (the order of work)'));
children.push(p([t('A.  Meta — ', { bold: true }), t('create a Business app + add WhatsApp; add & verify a dedicated number; complete business verification; create the templates; set the webhook to our whatsapp-webhook URL and subscribe to messages + statuses.', {})]));
children.push(p([t('B.  Supabase — ', { bold: true }), t('create the project; create the tables (Section 7); store the secrets; deploy the two functions (Section 8).', {})]));
children.push(p([t('C.  Shopify (India admin) — ', { bold: true }), t('create webhooks for order-created and fulfillment events pointing at our shopify-webhook URL (JSON); copy the signing secret into Supabase.', {})]));
children.push(p([t('D.  Website — ', { bold: true }), t('add a “Send my order updates on WhatsApp” opt-in checkbox at the India checkout + a privacy-policy line (the one small website change).', {})]));
children.push(p([t('E.  Team inbox — ', { bold: true }), t('deploy the dashboard and create staff logins.', {})]));
children.push(p([t('F.  Test & go live — ', { bold: true }), t('test order → message; test a customer message → bot; test “talk to a human” → inbox; then launch phase by phase.', {})]));

// 12. Costs
children.push(h1('12.  Costs'));
children.push(table([
  ['Item', 'Rough cost'],
  ['Supabase', 'Free tier to start; Pro ~ $25 / month (~Rs 2,100) only if usage grows'],
  ['Meta — WhatsApp message', 'Utility (order) message in India ~ Rs 0.10 – 0.25 each; many customer-started replies are free'],
  ['Dedicated phone number', 'A SIM / number (minor, one-time-ish)'],
  ['Developer time', 'The main cost — multi-week build across the 3 phases, plus ongoing maintenance'],
], [34, 66]));
children.push(p([t('The honest picture: ', { bold: true }), t('running cost is low (no app fee), but the real investment is developer time to build and then maintain it — Meta API changes, monitoring, retries, the inbox, bug-fixes. That is the trade we accept for full control and the lowest per-message cost.', {})]));

// 13. Glossary
children.push(h1('13.  Plain-language glossary'));
children.push(table([
  ['Term', 'What it means'],
  ['WhatsApp Cloud API', 'Meta’s official service that actually sends/receives WhatsApp messages for businesses.'],
  ['Template', 'A pre-approved message with blanks (name, order no., amount). Meta must approve it before use.'],
  ['Opt-in', 'The customer agreeing to receive WhatsApp messages. Required, or our number can get blocked.'],
  ['24-hour window', 'After a customer messages us, we can send free-form replies for 24 hours; after that, only templates.'],
  ['Webhook', 'An automatic “phone call” one system makes to another when an event happens.'],
  ['Edge Function', 'A small piece of code on Supabase that runs when a webhook arrives.'],
  ['Idempotency', 'Making sure the same event is never processed twice (no duplicate messages).'],
], [30, 70]));

// 14. Next
children.push(h1('14.  Next steps'));
children.push(bullet('Finalise the message wordings (order confirmed, COD, shipped) for Meta approval.'));
children.push(bullet('Design the exact FAQ menu (buttons + replies + business hours).'));
children.push(bullet('Write the detailed data model (columns) and the two function contracts.'));
children.push(bullet('Design the team-inbox screens.'));
children.push(bullet('Set up the Meta account + dedicated number, and the Supabase project.'));
children.push(new Paragraph({ spacing: { before: 260 }, alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'This is the plan we will follow — nothing is built yet. We start Phase 1 when you give the go-ahead.', italics: true, size: 19, color: MID, font: FONT })] }));

const doc = new Document({
  creator: 'Mir Kash', title: 'Mir Kash — WhatsApp Self-Build Plan',
  styles: { default: { document: { run: { font: FONT, size: 22 } } } },
  sections: [{ properties: { page: { margin: { top: 900, bottom: 900, left: 1000, right: 1000 } } }, children }],
});

const buf = await Packer.toBuffer(doc);
const out = join(process.cwd(), 'Mir-Kash-WhatsApp-Plan.docx');
writeFileSync(out, buf);
console.log('Wrote', out);
const desktop = join(homedir(), 'OneDrive', 'Desktop');
if (existsSync(desktop)) { const dst = join(desktop, 'Mir-Kash-WhatsApp-Plan.docx'); copyFileSync(out, dst); console.log('Copied to', dst); }
console.log('Diagram PNGs in', dumpDir);
