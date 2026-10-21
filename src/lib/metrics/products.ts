// Products: which bags get attention, which convert, which sell — and where demand
// meets a sold-out colour. From v_products (product page views + order lines).
import {
  both, column, countCell, FILTER, medianCell, meta, num, num0, rangeArgs, rateCell, table, type Row, type Run,
} from './core.ts';
import type { MetricsParams, Period, ProductsResponse, ValueKey } from './types.ts';

const SQL = `
  SELECT product,
         max(title) AS title,
         count(*) FILTER (WHERE kind = 'view') AS views,
         count(DISTINCT who) FILTER (WHERE kind = 'view') AS viewers,
         percentile_cont(0.5) WITHIN GROUP (ORDER BY engaged_ms) FILTER (WHERE kind = 'view') AS median_ms,
         count(engaged_ms) FILTER (WHERE kind = 'view') AS n_ms,
         percentile_cont(0.5) WITHIN GROUP (ORDER BY gallery_depth) FILTER (WHERE kind = 'view') AS median_gallery,
         percentile_cont(0.5) WITHIN GROUP (ORDER BY max_scroll) FILTER (WHERE kind = 'view') AS median_scroll,
         count(max_scroll) FILTER (WHERE kind = 'view') AS n_scroll,
         count(DISTINCT who) FILTER (WHERE kind = 'view' AND added_to_cart) AS carters,
         count(*) FILTER (WHERE kind = 'view' AND sold_out) AS sold_out_views,
         count(DISTINCT order_id) FILTER (WHERE kind = 'order') AS orders,
         COALESCE(sum(units) FILTER (WHERE kind = 'order'), 0) AS units,
         COALESCE(sum(revenue_inr) FILTER (WHERE kind = 'order'), 0) AS revenue
  FROM v_products
  WHERE ts >= $1 AND ts < $2 AND ${FILTER}
  GROUP BY product`;

async function load(run: Run, period: Period, p: MetricsParams): Promise<Row[]> {
  return run(SQL, rangeArgs(period, p));
}

export async function getProducts(run: Run, p: MetricsParams): Promise<ProductsResponse> {
  const [cur, prev] = await both(p, (per) => load(run, per, p));
  const columns = [
    column('views', 'productViews'),
    column('viewers', 'productViewers'),
    column('medianEngagedMs', 'productEngaged'),
    column('medianGalleryDepth', 'galleryDepth'),
    column('medianScroll', 'scrollDepth'),
    column('addToCartRate', 'addToCartRate'),
    column('orders', 'productOrders'),
    column('units', 'units'),
    column('revenue', 'productRevenue'),
    column('soldOutViews', 'soldOutViews'),
  ];
  return {
    ...meta('products', p, [
      'Add to cart counts adds made on the bag\'s own page; quick-adds from a collection grid can\'t be tied to a bag yet.',
    ]),
    section: 'products',
    table: table<ValueKey>(columns, cur, prev, (r) => String(r.product), (c, pr, first) => {
      const n = (r: Row, k: string) => num0(r[k]);
      const handle = String(first.product);
      return {
        key: { value: handle },
        label: String(c.title ?? pr.title ?? handle),
        cells: {
          views: countCell(n(c, 'views'), n(pr, 'views')),
          viewers: countCell(n(c, 'viewers'), n(pr, 'viewers')),
          medianEngagedMs: medianCell(num(c.median_ms), n(c, 'n_ms'), num(pr.median_ms)),
          medianGalleryDepth: medianCell(num(c.median_gallery), n(c, 'views'), num(pr.median_gallery)),
          medianScroll: medianCell(num(c.median_scroll), n(c, 'n_scroll'), num(pr.median_scroll)),
          addToCartRate: rateCell(n(c, 'carters'), n(c, 'viewers'), n(pr, 'carters'), n(pr, 'viewers')),
          orders: countCell(n(c, 'orders'), n(pr, 'orders')),
          units: countCell(n(c, 'units'), n(pr, 'units')),
          revenue: countCell(n(c, 'revenue'), n(pr, 'revenue')),
          soldOutViews: countCell(n(c, 'sold_out_views'), n(pr, 'sold_out_views')),
        },
      };
    }),
  };
}
