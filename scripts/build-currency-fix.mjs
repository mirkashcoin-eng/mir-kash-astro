// Generates "Mir-Kash-Local-Currency-Fix.docx" — admin steps to make the
// remaining countries show their LOCAL currency instead of USD.
// Run: node scripts/build-currency-fix.mjs
import { Document, Packer, Paragraph, TextRun, HeadingLevel } from 'docx';
import { writeFileSync, copyFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const CHERRY = '8B1A1A';
const INK = '2C1A0E';
const FONT = 'Calibri';

const title = (t) => new Paragraph({ alignment: 'center', spacing: { after: 60 }, children: [new TextRun({ text: t, bold: true, size: 36, color: INK, font: FONT })] });
const sub = (t) => new Paragraph({ alignment: 'center', spacing: { after: 240 }, children: [new TextRun({ text: t, size: 20, color: '6E6A64', font: FONT })] });
const h = (t) => new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { before: 240, after: 100 }, children: [new TextRun({ text: t, bold: true, size: 26, color: CHERRY, font: FONT })] });
const p = (t, bold = false) => new Paragraph({ spacing: { after: 100, line: 276 }, children: [new TextRun({ text: t, size: 22, color: '222222', bold, font: FONT })] });
const step = (n, t) => new Paragraph({ spacing: { after: 90, line: 276 }, indent: { left: 360, hanging: 360 }, children: [new TextRun({ text: `${n}.  `, bold: true, size: 22, color: INK, font: FONT }), new TextRun({ text: t, size: 22, color: '222222', font: FONT })] });
const bullet = (t) => new Paragraph({ bullet: { level: 0 }, spacing: { after: 60, line: 268 }, children: [new TextRun({ text: t, size: 21, color: '333333', font: FONT })] });

const children = [
  title('Mir Kash — Fix Local Currency for Remaining Countries'),
  sub('GLOBAL store (0dcac1). The India store stays INR — do not change it.'),

  p('Some countries already show their local currency correctly (UK £, Europe €, UAE AED, Australia A$, Singapore S$, Hong Kong HK$). But many countries still show prices in US dollars.'),
  p('Why: those countries sit in a Shopify market whose currency is still the base USD. A single market can only have ONE currency, so every country inside a USD market shows USD. The website is correct — it shows whatever Shopify returns; we just need Shopify set to local currency for these markets.', false),

  h('Countries still showing USD (to fix)'),
  bullet('Canada → CAD'),
  bullet('Switzerland → CHF'),
  bullet('Sweden → SEK,  Norway → NOK,  Denmark → DKK'),
  bullet('Japan → JPY'),
  bullet('New Zealand → NZD'),
  bullet('Saudi Arabia → SAR'),
  bullet('South Africa → ZAR'),
  bullet('Plus any other country inside the broad “America / Asia / Africa” region markets (they inherit USD).'),

  h('Step 0 — Prerequisite'),
  step(1, 'Settings → Payments → confirm Shopify Payments is active (required for multi-currency).'),

  h('Preferred fix — switch region markets to local currencies'),
  step(1, 'Settings → Markets.'),
  step(2, 'Open each market that still prices in USD (especially the broad ones: America, Asia, Africa — and any others).'),
  step(3, 'Go to “Currency and pricing.”'),
  step(4, 'Change it from a single fixed currency (USD) to “Local currencies” (sell in the customer’s own currency). Save.'),
  step(5, 'This makes every country in that market show its own currency automatically — no per-country setup needed.'),

  h('Alternative — if a market can’t use “local currencies”'),
  p('Some setups force one currency per market. In that case, create a dedicated market per currency — exactly like UK/UAE was done:'),
  step(1, 'Add market → add the country (e.g. Canada).'),
  step(2, 'Set its currency to the local one (e.g. CAD).'),
  step(3, 'Activate. Repeat for CHF, SEK, NOK, DKK, JPY, NZD, SAR, ZAR.'),

  h('Finish up'),
  step(1, 'Exchange rates: leave on Auto. Rounding: optional (e.g. nearest .99).'),
  step(2, 'Make sure products are available to these markets.'),
  step(3, 'Test: use “Preview” for a market, or open mirkash.com/en-ca, /en-jp, /en-ch — they should now show CAD / JPY / CHF.'),

  h('The one rule to remember'),
  p('A single Shopify market = one currency. A catch-all like “America (71 regions)” set to USD will show USD for every country in it (that’s why Canada shows US$). Either switch that market to “Local currencies,” or give those countries their own local-currency markets.', true),

  p('When done, tell the developer and they’ll re-test all countries to confirm each one converts.'),
];

const doc = new Document({
  creator: 'Mir Kash', title: 'Mir Kash — Local Currency Fix',
  styles: { default: { document: { run: { font: FONT, size: 22 } } } },
  sections: [{ children }],
});

const buf = await Packer.toBuffer(doc);
const out = join(process.cwd(), 'Mir-Kash-Local-Currency-Fix.docx');
writeFileSync(out, buf);
console.log('Wrote', out);
const desktop = join(homedir(), 'OneDrive', 'Desktop');
if (existsSync(desktop)) { const t = join(desktop, 'Mir-Kash-Local-Currency-Fix.docx'); copyFileSync(out, t); console.log('Copied to', t); }
