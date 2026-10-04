// Shared constants and helpers for the cart's "Before you go" panel (CartExitPanel.astro).
//
// The panel shows every time a visitor is about to leave a full cart: once per visit to the cart
// page, with no memory across visits (decided 4 Oct 2026). Within one page view it never repeats,
// so a second back press always leaves.

// Phones: this much visible time on the cart without checking out also counts as hesitating.
export const CX_LINGER_MS = 45_000;
// Desktop exit intent counts only after this long on the page.
export const CX_EXIT_MIN_MS = 10_000;
// The booking pages take at most this many bags.
export const MAX_BAGS = 6;

// `?bags=a,b,c` (and the older single `?bag=a`) → clean, de-duplicated handles, at most MAX_BAGS.
export function parseBags(bags: string | null | undefined, bag?: string | null): string[] {
  const all = [...String(bags ?? '').split(','), String(bag ?? '')]
    .map((h) => h.trim().toLowerCase())
    .filter((h) => /^[a-z0-9][a-z0-9-]*$/.test(h));
  return [...new Set(all)].slice(0, MAX_BAGS);
}
