export function shopifyImage(
  url: string | null | undefined,
  width = 800,
  format: 'webp' | 'jpg' | 'png' = 'webp',
): string {
  if (!url) return '';
  try {
    const u = new URL(url);
    u.searchParams.set('width', String(width));
    if (format) u.searchParams.set('format', format);
    return u.toString();
  } catch {
    return url;
  }
}

/** A studio main photo from the product-photo pipeline ("gigi-coral-pink-01.jpg"; Shopify may add "_<id>" on a
 *  name clash). These have wide backdrop around the bag, so product cards zoom them; older, tighter crops aren't zoomed. */
export function isStudioHero(url: string | null | undefined): boolean {
  if (!url) return false;
  try { return /^[a-z0-9]+(?:-[a-z0-9]+)*-01(?:_[0-9a-f-]+)?\.jpg$/i.test(new URL(url).pathname.split('/').pop() ?? ''); } catch { return false; }
}
