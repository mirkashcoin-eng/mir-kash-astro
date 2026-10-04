// Builds the prompt the founder pastes into Claude Code: it sorts the photos and writes catalog/products/<key>.json.
import template from '../content-prompt.md?raw';
import { getAllProducts } from '~/lib/shopify/queries';
import { BAG_SHIPPING, CATEGORY_OPTIONS, inboxPhotos, isPending, productExists, readPending, readProduct } from './catalog';

const EXAMPLE = {
  title: 'Braidey Shoulder Bag',
  seoTitle: 'Braidey | Apple Leather Shoulder Bag | Mir Kash',
  seoDescription: {
    india: 'Shop the Braidey by Mir Kash: our bestselling apple leather shoulder bag, with a braided texture and a roomy interior. Free shipping across India.',
    global: 'Shop the Braidey by Mir Kash: our bestselling apple leather shoulder bag, with a braided texture and a roomy interior. Ships internationally.',
  },
  descriptionHtml: "<p>Our bestseller, and it's easy to see why. The braided texture took six months to get right; long handles let it sit easy on the shoulder, and a light metal chain adds shine without the weight. Roomier than it looks. Italian apple leather.</p>",
  product_details: '• Material: Vegan apple leather\n• Material lining: Suede\n• Type of closure: Zipped\n• Soft braided texture\n• Lightweight metal chain\n• Zipped pocket inside\n• Comes with adjustable crossbody strap (detachable)\n• Very roomy, easily holds multiple everyday items',
  dimensions: 'Body H 15 × L 28 × W 8 cm · height with handles 41 cm',
  care_guide: '• Wipe clean with a soft, damp cloth.\n• Store it dry in its dust bag, with some stuffing inside to hold its shape.\n• Keep the braid from rubbing against other bags, so the texture stays crisp.\n• Use it often. Carrying your bags in rotation lets them air and keeps them in good condition.',
  material_name: 'Italian apple leather',
  material_story: 'Made from apple peels and cores left over from the fruit industry in Italy. A genuine byproduct, so nothing is wasted. It is soft to the touch, durable, and holds its shape over time. Fully vegan, with no animal hide anywhere in the bag.',
  feature_cards: [
    { eyebrow: 'What it holds', title: 'More than it lets on', body: 'Everything for a full day: wallet, phone, keys, sunglasses and the lip balm you always reach for.' },
    { eyebrow: 'Wear it to', title: 'Anywhere, really', body: 'The office, a long lunch, dinner after. The bag you pick up without thinking.' },
    { eyebrow: 'Good to know', title: 'Three ways to carry', body: 'On the shoulder, on the chain, or across the body with the detachable strap.' },
  ],
  story_slides: [
    { eyebrow: 'The texture', title: 'Six months on one braid', body: 'We reworked the braid until it felt as good as it looked: soft, sculpted, unmistakably ours.' },
    { eyebrow: 'The chain', title: 'Shine, without the weight', body: 'A metal chain for a modern finish, kept light enough to wear all day.' },
    { eyebrow: 'The shape', title: 'Made for the shoulder', body: 'Long handles that sit easily, and a shape that looks small but carries more.' },
    { eyebrow: 'The material', title: 'Italian apple leather', body: "Made from apple peels and cores left over from Italy's fruit industry. Nothing wasted." },
  ],
  faq: [
    { q: 'What is apple leather made of?', a: 'Apple peels and cores left over from the fruit industry in Italy. It is a genuine byproduct, so nothing is wasted, and the bag is fully vegan.' },
    { q: 'Does it come with a crossbody strap?', a: 'Yes. An adjustable crossbody strap is included, and the chain and straps are detachable.' },
    { q: 'How long does the bag last?', a: 'Years, not seasons. Mir Kash bags are made slowly and built to be carried every day. Wipe it clean, store it in its dust bag, and it will hold its shape for a long time. It is also covered by our 1-year warranty against manufacturing defects.' },
    { q: 'What is a vegan bag?', a: 'A bag made with no animal materials anywhere: not in the body, the lining, the trims or the base. This one is made from Italian apple leather, so no animal hide is used at any stage.' },
  ],
};

const list = (items: string[]) => items.map((t) => `"${t}"`).join(', ');

export async function buildPrompt(id: string): Promise<string> {
  const exists = productExists(id);
  const P = exists ? readProduct(id) : null;
  if (!exists && !isPending(id)) throw new Error('Unknown product');
  const name = P ? P.name || P.title : readPending(id).name;
  const key = P ? P.key : id;
  const KEY = key.toUpperCase();

  const loose = inboxPhotos(key);
  const photos = loose.length
    ? `${loose.length} photo(s), not sorted yet: ${loose.map((f) => `\`${f}\``).join(', ')}.`
    : 'The photos are already sorted into colour folders; leave them as they are unless they look wrong.';

  const live = await getAllProducts('global', 'US', 100)
    .then((ps) => ps.filter((p) => Number(p.sizeOrder?.value) > 0 && p.handle !== P?.handle)
      .sort((a, b) => Number(a.sizeOrder!.value) - Number(b.sizeOrder!.value))
      .map((p) => `${p.sizeOrder!.value} ${p.title}`).join(', '))
    .catch(() => '(could not load it; use your best judgement)');

  const skeleton = {
    key, name,
    title: '…', handle: '…', productType: '…', category: '…',
    tags: ['new', '…'],
    seoTitle: '…', seoDescription: { india: '…', global: '…' },
    descriptionHtml: '<p>…</p>',
    colours: [{ name: '…', folder: '…', sku: `MK-${KEY}-…` }],
    price: { india: '… rupees, digits only', global: '… US dollars, digits only' },
    stock: { india: 0, global: 0 },
    grams: 0,
    custom: {
      product_details: '• …\n• …', dimensions: '…', care_guide: '• …\n• …', material_name: '…', material_story: '…',
      feature_cards: '[{"eyebrow": "What it holds", "title": "…", "body": "…"}, …]',
      story_slides: '[{"eyebrow": "…", "title": "…", "body": "…", "image": ""}, …]',
      faq: '[{"q": "…", "a": "…"}, …]',
      size_group: '…', size_order: '…',
    },
    banner: { desktop: '', mobile: '' },
    shippingReturn: BAG_SHIPPING,
    categoryAttrs: { '…': ['…'] },
    google: {},
  };

  const existing = exists
    ? `\n**This product already has a file:** \`catalog/products/${id}.json\`. Update it from my notes rather than starting again: keep its \`pushed\`, \`uploads\`, \`banner\` and story slide \`image\` values, and keep prices and stock unless my notes changed them.\n`
    : '';

  return template
    .replaceAll('{{NAME}}', () => name)
    .replaceAll('{{KEY}}', () => key)
    .replace('{{EXISTING}}', () => existing)
    .replace('{{PHOTOS}}', () => photos)
    .replace('{{SKELETON}}', () => JSON.stringify(skeleton, null, 2))
    .replace('{{TYPES}}', () => list(['Shoulder Bags', 'Crossbody Bags', 'Tote Bags', 'Mini Bags', 'Clutch Bags', 'Charms']))
    .replace('{{CATEGORIES}}', () => CATEGORY_OPTIONS.map((c) => `  - "${c.id}" (${c.name})`).join('\n'))
    .replace('{{MATERIALS}}', () => list(['apple-leather', 'vegan-leather', 'velvet', 'satin']))
    .replace('{{OCCASIONS}}', () => list(['occasion-everyday', 'occasion-work', 'occasion-evening', 'occasion-party', 'occasion-travel']))
    .replace('{{LIVE}}', () => live)
    .replace('{{EXAMPLE}}', () => JSON.stringify(EXAMPLE, null, 2));
}
