Please build the product file for a new Mir Kash product, **{{NAME}}**, for the catalog tool (catalog/ in this project). Mir Kash makes vegan handbags and a few small accessories, made slowly, sold in India and internationally. The website is fashion first: being vegan is an advantage, never the headline.
{{EXISTING}}
## What you have

- **My notes:** the `**{{NAME}}**` section of `catalog/Master-Product descriptions.md`. These are transcribed voice notes (expect typos and repetition), and they are the only source of facts.
- **The photos:** `catalog/photos/{{KEY}}/`. {{PHOTOS}}
- **The page rules:** `catalog/PRODUCT-PAGE-STRUCTURE.md`. Read all of it, especially "Writing rules", "FAQ question bank" and "Main keyword per bag". The brand guide, `brand-wiki/Mir Kash_Brand Guidelines.pdf (1).pdf`, is the final authority.
- **A finished product in the same file format:** `catalog/products/tassel-charm.json` (a charm, so it has no care section and no warranty). Ignore its `uploads` and `pushed` fields.

## Step 1: sort the photos

Look at every photo. Make one folder per colour of the product in `catalog/photos/{{KEY}}/`, named after the colour in lowercase with dashes (e.g. `cherry-red`), and move that colour's photos into it, renamed in gallery order:

- `01.<ext>`: the plain product shot on a plain background. This is the main photo.
- `02-<label>.<ext>`, `03-<label>.<ext>` …: then model and detail shots. The label is 2–6 words, in lowercase with dashes, saying what the photo shows (`worn-on-the-shoulder`, `inside-view`). It becomes the photo's description for Google.
- Keep each file's extension. Never delete a photo. If you can't tell which colour a photo belongs to, move it to `catalog/photos/{{KEY}}/_unsorted/` and tell me.

## Step 2: write `catalog/products/{{KEY}}.json`

Use exactly this shape, replacing every "…":

```json
{{SKELETON}}
```

Facts:
- Price, stock, weight, dimensions, materials, features and colours come only from my notes. **If the India price (₹), the Global price (US$) or the stock per colour isn't in my notes, ask me before writing the file. Never guess a number.**
- `colours`: one entry per colour folder from step 1. Names in title case, like the store's (Cherry Red, Olive Green, Nude). If a colour name isn't in `src/lib/colour-swatch.ts`, add it there with a hex that matches the photos.
- `productType`: one of {{TYPES}}.
- `category`: one of these Shopify categories:
{{CATEGORIES}}
- `tags`: always "new". One material tag: {{MATERIALS}}. Occasions that fit: {{OCCASIONS}}. Add "size-mini" for a mini bag, "laptop-friendly" if it fits a laptop, and "no-warranty" if the product has no 1-year warranty (a bag has one unless my notes say otherwise; a small accessory usually doesn't).
- `custom.size_group`: Mini, Small, Medium, Large or Accessory. `custom.size_order` places it in Shop All, smallest first. The number is the group (Mini 1x, Small 2x, Medium 3x, Large 4x, Accessory 9x) plus its rank inside the group. Today's order: {{LIVE}}.
- `categoryAttrs`: Shopify's own attributes, using Shopify's value names. For a bag: "target-gender": ["Female"], "age-group": ["Adults"], "carry-options" from [Handle, Shoulder strap, Crossbody strap, Detachable strap], "bag-case-material" one of [Faux leather, Microfiber, Velvet, Synthetic], "bag-case-features" from [Convertible, Lightweight, Vegan-friendly, Dustproof], "bag-case-storage-features": ["Built-in compartments"] if it has inner pockets. For anything that isn't a bag, use {}.
- `shippingReturn`: keep the text in the shape above for a bag. For something that isn't a bag, change "if the bag is unused, with its dust bag and Mir Kash box" to "if the item is unused, in its original packaging".

Copy (follow PRODUCT-PAGE-STRUCTURE.md):
- `title`: name and type, e.g. "Braidey Shoulder Bag". `handle`: the title in lowercase with dashes.
- `seoTitle`: `[Name] | [Material] [Type] | Mir Kash`, 60 characters or fewer.
- `seoDescription`: 120–160 characters each. India ends exactly "Free shipping across India."; Global ends exactly "Ships internationally."
- `descriptionHtml`: one `<p>`, 2–3 sentences, about 40–60 words: the design, then what it holds and when to wear it, then the material in a few words.
- `custom.product_details`: one "• " line each: Material, Material lining, Type of closure, 3–4 features, what's included, how much it holds. `custom.dimensions`: centimetres, e.g. "H 16 × L 18 × W 6 cm". `custom.care_guide`: "• " lines, or "" if there are no care tips.
- `custom.material_name` (e.g. "Italian apple leather") and `custom.material_story` (2–4 sentences: the material reveal).
- `custom.feature_cards`: 3 cards: "What it holds", "Wear it to", "Good to know" (for a non-bag, swap "What it holds" for something that suits it).
- `custom.story_slides`: 3–4 slides, one signature detail each, the material slide last. Leave each "image" as "".
- `custom.faq`: 4–6 questions from the question bank, including "How long does the bag last?" and "What is a vegan bag?" for a bag. Don't mention a warranty if there is none.
- Never use: sustainable, eco-friendly, luxury, premium, ethical, conscious, curated, elevate, "100% cruelty-free", journey, handcrafted, mimics. "Handmade" is fine. No italics, no hook line or tagline, British spelling. Only name materials my notes confirm; never cactus or mushroom leather.
- `feature_cards`, `story_slides` and `faq` are JSON written as text (a string), exactly as in tassel-charm.json.

Here is the Braidey Shoulder Bag's live copy, as an example of the voice and length:

```json
{{EXAMPLE}}
```

## Step 3

Check the file is valid JSON. Then tell me it's done, and list anything you weren't sure about. The catalog tool opens the product by itself.
