// Colour name → swatch colour for the product page (best-effort; unknown names fall back to a neutral grey).
// A new colour name needs an entry here, or its swatch shows grey. The catalog tool warns about that.
export const COLOR_HEX: Record<string, string> = {
  taupe: '#8B7355', onyx: '#1a1a1a', black: '#1a1a1a', cognac: '#C8895A',
  stone: '#C4BFB6', plum: '#5C2D3E', tan: '#C8A06A', brown: '#6B4A2B',
  beige: '#D9CBB5', cream: '#EDE5D5', ivory: '#F0E6D3', white: '#f4f1ea',
  sand: '#D4B896', camel: '#C4882B', red: '#9B1B1B', cherry: '#8B1A1A',
  'cherry red': '#8B1A1A', maroon: '#5C1A1A',
  green: '#2D5016', forest: '#2D5016', olive: '#6E6B23', 'olive green': '#6E6B23',
  navy: '#1A2340', blue: '#3A4A6B', midnight: '#1A2340',
  grey: '#8a8a8a', gray: '#8a8a8a', silver: '#C4C7CC',
  pink: '#C9A09A', rose: '#C9A09A', coral: '#F0908A', 'coral pink': '#F0908A',
  caramel: '#C88A46', gold: '#C6A44E', nude: '#E3C3A8', oat: '#E0D4BE',
  fig: '#4A1942', sage: '#8E9E7E', sky: '#9DBCE0',
};
export const UNKNOWN_SWATCH = '#bdb5a8';

// Match the full name, then any two-word phrase, then any single colour word.
// Two-colour names ("Rose & Sage", "Cream & Cherry Red") get a split swatch, half each colour.
export function hexFor(raw: string): string {
  const parts = raw.split(/\s*&\s*/).filter(Boolean);
  if (parts.length === 2) return `linear-gradient(135deg, ${hexFor(parts[0])} 50%, ${hexFor(parts[1])} 50%)`;
  const key = raw.trim().toLowerCase();
  if (COLOR_HEX[key]) return COLOR_HEX[key];
  const words = key.split(/[^a-z]+/).filter(Boolean);
  for (let i = 0; i < words.length - 1; i++) {
    const pair = `${words[i]} ${words[i + 1]}`;
    if (COLOR_HEX[pair]) return COLOR_HEX[pair];
  }
  for (const w of words) if (COLOR_HEX[w]) return COLOR_HEX[w];
  return UNKNOWN_SWATCH;
}

/** False when (any half of) the name has no swatch colour, so the page would show grey. */
export const swatchKnown = (name: string) => name.split(/\s*&\s*/).filter(Boolean).every((p) => hexFor(p) !== UNKNOWN_SWATCH);
