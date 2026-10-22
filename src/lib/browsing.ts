// What a person looked at, rolled up from their events (People drawer).
type Row = Record<string, any>;
const n = (v: unknown): number => (v == null ? 0 : Number(v));
const iso = (v: unknown): string | null => (v instanceof Date ? v.toISOString() : v == null ? null : String(v));

// Pages and bags, rolled up from the person's events. The market prefix (/en-ae/…) is
// dropped so one page seen on two market paths counts once. Engaged time is the longest
// page_engaged reading per page view (it is re-sent as the visit goes on), then summed.
export const normPath = (p: unknown): string => {
  const s = String(p ?? '/').split('?')[0].replace(/^\/[a-z]{2}-[a-z]{2}(?=\/|$)/i, '');
  return s.length > 1 ? s.replace(/\/+$/, '') : '/';
};

export function browsing(events: Row[]) {
  const ms = new Map<string, number>();
  const scroll = new Map<string, number>();
  for (const e of events) {
    if (e.name !== 'page_engaged' || !e.page_view_id) continue;
    const pr = (e.props ?? {}) as Row;
    ms.set(e.page_view_id, Math.max(ms.get(e.page_view_id) ?? 0, n(pr.ms)));
    scroll.set(e.page_view_id, Math.max(scroll.get(e.page_view_id) ?? 0, n(pr.scroll)));
  }
  const pages = new Map<string, { path: string; views: number; last: string; views_pv: Set<string> }>();
  const bags = new Map<string, { handle: string; views: number; sold_out: number; carts: number; last: string; pv: Set<string> }>();
  for (const e of events) {
    const at = iso(e.ts) as string;
    if (e.name === 'page_view') {
      const path = normPath(e.page);
      const g = pages.get(path) ?? { path, views: 0, last: at, views_pv: new Set<string>() };
      g.views++; if (at > g.last) g.last = at;
      if (e.page_view_id) g.views_pv.add(e.page_view_id);
      pages.set(path, g);
    }
    if (e.product) {
      const b = bags.get(e.product) ?? { handle: e.product, views: 0, sold_out: 0, carts: 0, last: at, pv: new Set<string>() };
      if (e.name === 'product_view') b.views++;
      else if (e.name === 'sold_out_view') b.sold_out++;
      else if (e.name === 'add_to_cart') b.carts++;
      else continue;   // gallery, zoom, swatch … belong to a view already counted
      if (at > b.last) b.last = at;
      if (e.page_view_id) b.pv.add(e.page_view_id);
      bags.set(e.product, b);
    }
  }
  const secs = (ids: Set<string>) => Math.round([...ids].reduce((t, id) => t + (ms.get(id) ?? 0), 0) / 1000);
  return {
    pages: [...pages.values()]
      .map((g) => ({ path: g.path, views: g.views, last_at: g.last, engaged_s: secs(g.views_pv),
        max_scroll: Math.max(0, ...[...g.views_pv].map((id) => scroll.get(id) ?? 0)) }))
      .sort((a, b) => b.views - a.views || b.last_at.localeCompare(a.last_at)).slice(0, 40),
    products: [...bags.values()]
      .map((b) => ({ handle: b.handle, views: b.views, sold_out_views: b.sold_out, cart_adds: b.carts, last_at: b.last, engaged_s: secs(b.pv) }))
      .sort((a, b) => b.last_at.localeCompare(a.last_at)),
  };
}

