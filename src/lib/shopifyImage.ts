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
