// Generates "Mir-Kash-Multi-Currency-Setup.docx" — a clean, forwardable step-by-step
// guide for enabling Shopify Markets / multi-currency on the Global store.
// Run: node scripts/build-currency-guide.mjs
import { Document, Packer, Paragraph, TextRun, HeadingLevel } from 'docx';
import { writeFileSync, copyFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const CHERRY = '8B1A1A';
const INK = '2C1A0E';
const FONT = 'Calibri';

const title = (t) => new Paragraph({
  alignment: 'center', spacing: { after: 60 },
  children: [new TextRun({ text: t, bold: true, size: 36, color: INK, font: FONT })],
});
const sub = (t) => new Paragraph({
  alignment: 'center', spacing: { after: 240 },
  children: [new TextRun({ text: t, size: 20, color: '6E6A64', font: FONT })],
});
const h = (t) => new Paragraph({
  heading: HeadingLevel.HEADING_2, spacing: { before: 240, after: 100 },
  children: [new TextRun({ text: t, bold: true, size: 26, color: CHERRY, font: FONT })],
});
const p = (t, bold = false) => new Paragraph({
  spacing: { after: 100, line: 276 },
  children: [new TextRun({ text: t, size: 22, color: '222222', bold, font: FONT })],
});
const step = (n, t) => new Paragraph({
  spacing: { after: 90, line: 276 }, indent: { left: 360, hanging: 360 },
  children: [
    new TextRun({ text: `${n}.  `, bold: true, size: 22, color: INK, font: FONT }),
    new TextRun({ text: t, size: 22, color: '222222', font: FONT }),
  ],
});
const bullet = (t) => new Paragraph({
  bullet: { level: 0 }, spacing: { after: 60, line: 268 },
  children: [new TextRun({ text: t, size: 21, color: '333333', font: FONT })],
});

const children = [
  title('Mir Kash — Enable Multi-Currency (Shopify Markets)'),
  sub('Step-by-step for the GLOBAL store (the India store stays INR — do not change it)'),

  p('Goal: show every international customer prices in their own local currency (GBP, EUR, AED, etc.) and charge them in that currency at checkout. This is all done in Shopify admin — no code from us is needed to switch it on.'),

  h('Step 0 — Prerequisite: Payments'),
  step(1, 'Go to Settings → Payments.'),
  step(2, 'Make sure Shopify Payments is activated. (Shopify Payments automatically converts and charges customers in their local currency.)'),
  step(3, 'If a third-party gateway (e.g. PayPal only) is used instead, note its name and tell us — some gateways can only charge in the store’s base currency, which limits multi-currency.'),

  h('Step 1 — Open Markets'),
  step(1, 'Go to Settings → Markets.'),
  step(2, 'You will see your markets (usually a primary market plus an “International” catch-all market).'),

  h('Step 2 — Add the countries to sell to'),
  step(1, 'Click “Add market” (or edit the existing “International” market).'),
  step(2, 'Name it (e.g. “Europe” or “Rest of World”).'),
  step(3, 'Add the countries / regions you want to sell to (United Kingdom, EU countries, UAE, Australia, etc.).'),
  step(4, 'You can keep many countries in one market, or create separate markets per region if you want different currency/rounding per region.'),

  h('Step 3 — Turn on local currency'),
  step(1, 'Open the market → Settings → “Currency and pricing.”'),
  step(2, 'Set it to sell in the customer’s local currency (e.g. UK market → GBP, EU market → EUR).'),
  step(3, 'Save. Repeat for each market / region you created.'),

  h('Step 4 — Exchange rates & rounding (recommended)'),
  step(1, 'In the same Currency and pricing settings:'),
  bullet('Exchange rates: leave on “Auto” so Shopify uses live daily rates (manual rates are also possible).'),
  bullet('Rounding: e.g. round to the nearest .99 so converted prices look clean (£9.99 instead of £9.73).'),

  h('Step 5 — Activate & make products available'),
  step(1, 'Confirm each market shows “Active.”'),
  step(2, 'Make sure products are available to those markets (Products → product → Markets / availability; usually available to all by default).'),

  h('Step 6 — Test'),
  step(1, 'In Markets, use “Preview” for a market — OR open the live store and switch country.'),
  step(2, 'Prices should now show in that country’s currency.'),
  step(3, 'Add to cart → checkout should display and charge in the local currency.'),

  h('When it’s done — send back to the developer'),
  p('Once the above is live, reply with:'),
  bullet('Which currencies / countries are now enabled.'),
  bullet('Which payment provider the Global store uses.'),
  p('Then the developer makes the small code change so the website reads the visitor’s country and shows the correct local currency automatically (prices and checkout always match — no manual exchange rates).'),

  p('Note: This applies to the GLOBAL store only. The India store stays on INR with its own payment setup.', true),
];

const doc = new Document({
  creator: 'Mir Kash',
  title: 'Mir Kash — Enable Multi-Currency',
  styles: { default: { document: { run: { font: FONT, size: 22 } } } },
  sections: [{ children }],
});

const buf = await Packer.toBuffer(doc);
const out = join(process.cwd(), 'Mir-Kash-Multi-Currency-Setup.docx');
writeFileSync(out, buf);
console.log('Wrote', out);

const desktop = join(homedir(), 'OneDrive', 'Desktop');
if (existsSync(desktop)) {
  const target = join(desktop, 'Mir-Kash-Multi-Currency-Setup.docx');
  copyFileSync(out, target);
  console.log('Copied to', target);
}
