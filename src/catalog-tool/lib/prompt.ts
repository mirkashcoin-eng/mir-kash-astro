// Builds the "paste this into Claude" prompt for one product.
import fs from 'node:fs';
import template from '../content-prompt.md?raw';
import { STRUCTURE_FILE } from './paths.mjs';
import { CATEGORY_OPTIONS, readNotes, type ProductFile } from './catalog';

const EXAMPLE = {
  title: 'Braidey Shoulder Bag',
  seoTitle: 'Braidey | Apple Leather Shoulder Bag | Mir Kash',
  seoDescriptionIndia: 'Shop the Braidey by Mir Kash: our bestselling apple leather shoulder bag, with a braided texture and a roomy interior. Free shipping across India.',
  seoDescriptionGlobal: 'Shop the Braidey by Mir Kash: our bestselling apple leather shoulder bag, with a braided texture and a roomy interior. Ships internationally.',
  description: "Our bestseller, and it's easy to see why. The braided texture took six months to get right; long handles let it sit easy on the shoulder, and a light metal chain adds shine without the weight. Roomier than it looks. Italian apple leather.",
  details: ['Material: Vegan apple leather', 'Material lining: Suede', 'Type of closure: Zipped', 'Soft braided texture', 'Lightweight metal chain', 'Zipped pocket inside', 'Comes with adjustable crossbody strap (detachable)', 'Very roomy, easily holds multiple everyday items'],
  dimensions: 'Body H 15 × L 28 × W 8 cm · height with handles 41 cm',
  care: ['Wipe clean with a soft, damp cloth.', 'Store it dry in its dust bag, with some stuffing inside to hold its shape.', 'Keep the braid from rubbing against other bags, so the texture stays crisp.', 'Use it often. Carrying your bags in rotation lets them air and keeps them in good condition.'],
  materialName: 'Italian apple leather',
  materialStory: 'Made from apple peels and cores left over from the fruit industry in Italy. A genuine byproduct, so nothing is wasted. It is soft to the touch, durable, and holds its shape over time. Fully vegan, with no animal hide anywhere in the bag.',
  featureCards: [
    { eyebrow: 'What it holds', title: 'More than it lets on', body: 'Everything for a full day: wallet, phone, keys, sunglasses and the lip balm you always reach for.' },
    { eyebrow: 'Wear it to', title: 'Anywhere, really', body: 'The office, a long lunch, dinner after. The bag you pick up without thinking.' },
    { eyebrow: 'Good to know', title: 'Three ways to carry', body: 'On the shoulder, on the chain, or across the body with the detachable strap.' },
  ],
  storySlides: [
    { eyebrow: 'The texture', title: 'Six months on one braid', body: 'We reworked the braid until it felt as good as it looked: soft, sculpted, unmistakably ours.' },
    { eyebrow: 'The chain', title: 'Shine, without the weight', body: 'A metal chain for a modern finish, kept light enough to wear all day.' },
    { eyebrow: 'The shape', title: 'Made for the shoulder', body: 'Long handles that sit easily, and a shape that looks small but carries more.' },
    { eyebrow: 'The material', title: 'Italian apple leather', body: "Made from apple peels and cores left over from Italy's fruit industry. Nothing wasted." },
  ],
  faq: [
    { q: 'What is apple leather made of?', a: 'Apple peels and cores left over from the fruit industry in Italy. It is a genuine byproduct, so nothing is wasted, and the bag is fully vegan.' },
    { q: 'Is apple leather durable?', a: 'Yes. It is soft to the touch but durable, and holds its shape well over time. Wipe it with a damp cloth and store it in its dust bag.' },
    { q: 'Does it come with a crossbody strap?', a: 'Yes. An adjustable crossbody strap is included, and the chain and straps are detachable.' },
    { q: 'How long does the bag last?', a: 'Years, not seasons. Mir Kash bags are made slowly and built to be carried every day. Wipe it clean, store it in its dust bag, and it will hold its shape for a long time. It is also covered by our 1-year warranty against manufacturing defects.' },
    { q: 'What is a vegan bag?', a: 'A bag made with no animal materials anywhere: not in the body, the lining, the trims or the base. This one is made from Italian apple leather, so no animal hide is used at any stage.' },
  ],
};

const MATERIAL_TAGS: Record<string, string> = { 'apple-leather': 'apple leather', 'vegan-leather': 'vegan leather', velvet: 'velvet', satin: 'satin' };

export function buildPrompt(P: ProductFile, hasCare: boolean): string {
  const accessory = /TaxonomyCategory\/aa-4/.test(P.category);
  const material = P.tags.map((t) => MATERIAL_TAGS[t]).filter(Boolean).join(', ');
  const occasions = P.tags.filter((t) => t.startsWith('occasion-')).map((t) => t.replace('occasion-', ''));
  const carry = P.categoryAttrs['carry-options'] ?? [];
  const facts = [
    `- Product name: ${P.name || P.title}`,
    `- Kind: ${accessory ? 'an accessory, not a bag (do not call it a bag)' : 'a handbag'}`,
    `- Product type: ${P.productType || 'not set'}; Shopify category: ${CATEGORY_OPTIONS.find((c) => c.id === P.category)?.name ?? P.category}`,
    P.custom.size_group && `- Size group in the shop: ${P.custom.size_group}`,
    `- Colours: ${P.colours.map((c) => c.name).join(', ') || 'not set'}`,
    material && `- Material (from the shop's tags): ${material}`,
    Number(P.grams) > 0 && `- Weight: ${P.grams} g`,
    carry.length > 0 && `- Ways to carry: ${carry.join(', ')}`,
    occasions.length > 0 && `- Occasions: ${occasions.join(', ')}`,
    `- Warranty: ${P.tags.includes('no-warranty') ? 'none. Do not mention a warranty anywhere.' : '1-year warranty against manufacturing defects'}`,
    `- Care section: ${hasCare ? 'yes' : 'none. Return "care": [].'}`,
  ].filter(Boolean).join('\n');

  const notes = readNotes(P.name || P.title) || '(No notes saved yet. Write the notes in the tool and press Save first.)';
  const writer = P.writerNotes?.trim() ? `\n# Instructions from the founder for this product\n\n${P.writerNotes.trim()}\n` : '';
  const structure = fs.existsSync(STRUCTURE_FILE) ? fs.readFileSync(STRUCTURE_FILE, 'utf8') : '(catalog/PRODUCT-PAGE-STRUCTURE.md is missing.)';

  return template
    .replace('{{FACTS}}', () => facts)
    .replace('{{NOTES}}', () => notes)
    .replace('{{WRITER_NOTES}}', () => writer)
    .replace('{{EXAMPLE}}', () => '```json\n' + JSON.stringify(EXAMPLE, null, 2) + '\n```')
    .replace('{{STRUCTURE}}', () => structure);
}
