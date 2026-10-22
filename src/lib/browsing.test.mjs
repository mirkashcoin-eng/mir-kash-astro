// Self-check for the "what they looked at" rollup in the People drawer.
// Run: node src/lib/browsing.test.mjs   (Node 23.6+ imports the .ts directly)
import assert from 'node:assert/strict';
import { browsing, normPath } from './browsing.ts';

assert.equal(normPath('/en-ae/products/tote'), '/products/tote');
assert.equal(normPath('/products/tote/?x=1'), '/products/tote');
assert.equal(normPath('/en-fr'), '/');
assert.equal(normPath(null), '/');

const t = (m) => new Date(Date.UTC(2026, 9, 22, 10, m)).toISOString();
const ev = (name, m, o = {}) => ({ name, ts: t(m), ...o });
const b = browsing([
  ev('page_view', 0, { page: '/', page_view_id: 'a' }),
  ev('page_engaged', 1, { page: '/', page_view_id: 'a', props: { ms: 10000, scroll: 40 } }),
  ev('page_engaged', 2, { page: '/', page_view_id: 'a', props: { ms: 30000, scroll: 80 } }),   // re-sent: longest wins, not summed
  ev('page_view', 3, { page: '/en-ae/products/tote', page_view_id: 'b' }),
  ev('product_view', 3, { page: '/en-ae/products/tote', page_view_id: 'b', product: 'tote' }),
  ev('gallery_view', 4, { page: '/products/tote', page_view_id: 'b', product: 'tote' }),       // not counted as a view
  ev('add_to_cart', 5, { page: '/products/tote', page_view_id: 'b', product: 'tote' }),
  ev('page_engaged', 6, { page: '/products/tote', page_view_id: 'b', props: { ms: 45000, scroll: 100 } }),
  ev('page_view', 7, { page: '/', page_view_id: 'c' }),
  ev('sold_out_view', 8, { page: '/products/clutch', page_view_id: 'd', product: 'clutch' }),
]);
const home = b.pages.find((p) => p.path === '/');
assert.equal(home.views, 2);
assert.equal(home.engaged_s, 30);
assert.equal(home.max_scroll, 80);
assert.equal(b.pages[0].path, '/', 'most-visited page first');
const tote = b.products.find((p) => p.handle === 'tote');
assert.deepEqual([tote.views, tote.cart_adds, tote.sold_out_views, tote.engaged_s], [1, 1, 0, 45]);
const clutch = b.products.find((p) => p.handle === 'clutch');
assert.deepEqual([clutch.views, clutch.sold_out_views, clutch.engaged_s], [0, 1, 0]);
assert.equal(b.products[0].handle, 'clutch', 'most recently seen bag first');
assert.deepEqual(browsing([]), { pages: [], products: [] });
console.log('browsing: ok');
