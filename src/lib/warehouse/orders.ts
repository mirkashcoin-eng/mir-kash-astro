// Shopify orders (+ the returns on them) → Neon `orders` / `returns`, an exact mirror.
// Order notifications go to a separate Supabase service, so this app gets no order
// webhooks (see api/admin/shopify-hooks.ts); instead /api/cron/sync-shopify pulls
// every order UPDATED since the last run, oldest first, paginated to the end, and
// upserts it. `full` re-reads every order and drops rows Shopify no longer has.
// Row mapping is pure and tested: ./shopify-map.ts.
//
// Best-effort like the rest of analytics: failures are logged and reported in the
// result, never thrown, and the watermark only moves past pages that were written.
import { q, tx } from '~/lib/db';
import { runAdminQuery } from '~/lib/shopify/admin';
import { orderRow, orderReturns, portalReturnId, rateOn, type OrderNode, type OrderRow, type ReturnRow, type Store } from './shopify-map';
import { personIdFor } from '~/lib/events';

function getEnv(key: string): string {
  if (typeof process !== 'undefined' && process.env && process.env[key]) return process.env[key] as string;
  const meta = import.meta.env as Record<string, string | undefined>;
  return meta[key] ?? '';
}

// ── Shopify Admin, both stores ──────────────────────────────────────────────

// Global has no app in the code yet, only the static Admin token the catalog tool
// uses; without it the Global store is skipped (and the result says so).
export function storesConfigured(): Store[] {
  const out: Store[] = ['india'];
  if (getEnv('SHOPIFY_GLOBAL_ADMIN_DOMAIN') && getEnv('SHOPIFY_GLOBAL_ADMIN_TOKEN')) out.push('global');
  return out;
}

async function globalQuery<T>(query: string, variables: Record<string, unknown>): Promise<T | null> {
  try {
    const res = await fetch(`https://${getEnv('SHOPIFY_GLOBAL_ADMIN_DOMAIN')}/admin/api/2025-01/graphql.json`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': getEnv('SHOPIFY_GLOBAL_ADMIN_TOKEN') },
      body: JSON.stringify({ query, variables }),
    });
    const json = (await res.json()) as { data?: T; errors?: unknown };
    if (json.errors) { console.error('[warehouse] global GraphQL errors:', JSON.stringify(json.errors)); return null; }
    return json.data ?? null;
  } catch (e) {
    console.error('[warehouse] global request failed:', e);
    return null;
  }
}

// One Admin GraphQL call on either store. A null (throttled, network blip) is retried
// twice with a pause before giving up — a sync page is cheap to repeat.
export async function shopifyQuery<T>(store: Store, query: string, variables: Record<string, unknown> = {}): Promise<T | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt) await new Promise((r) => setTimeout(r, 2000 * attempt));
    const data = store === 'india' ? await runAdminQuery<T>(query, variables) : await globalQuery<T>(query, variables);
    if (data) return data;
  }
  return null;
}

// ── Sync state ──────────────────────────────────────────────────────────────

export async function getCursor(key: string): Promise<string | null> {
  const rows = await q<{ cursor: Date | null }>('SELECT cursor FROM sync_state WHERE key = $1', [key]);
  return rows?.[0]?.cursor ? rows[0].cursor.toISOString() : null;
}

export async function saveState(key: string, cursor: string | null, result?: unknown): Promise<void> {
  await q(
    `INSERT INTO sync_state (key, cursor, last_run_at, last_result) VALUES ($1, $2, now(), $3::jsonb)
     ON CONFLICT (key) DO UPDATE SET cursor = GREATEST(sync_state.cursor, EXCLUDED.cursor),
       last_run_at = now(), last_result = COALESCE(EXCLUDED.last_result, sync_state.last_result)`,
    [key, cursor, result === undefined ? null : JSON.stringify(result)],
  );
}

// Shopify's search index trails writes by a few seconds, so each run re-reads a short
// overlap before the watermark. Upserts make the repeat harmless.
export function sinceQuery(cursor: string | null): string | null {
  if (!cursor) return null;
  const t = new Date(new Date(cursor).getTime() - 10 * 60_000).toISOString().replace(/\.\d{3}Z$/, 'Z');
  return `updated_at:>='${t}'`;
}

// ── FX ──────────────────────────────────────────────────────────────────────

// Daily ECB reference rates (Frankfurter: free, no key), cached per currency for the
// life of the function instance. Only Global orders need this — see totalInr().
const fxCache = new Map<string, { from: string; to: string; series: Record<string, number> }>();

async function fxSeries(currency: string, from: string, to: string): Promise<Record<string, number> | null> {
  const hit = fxCache.get(currency);
  if (hit && hit.from <= from && hit.to >= to) return hit.series;
  // A week of slack before, so a weekend/holiday at the start still has a prior rate.
  const start = new Date(Date.parse(from) - 7 * 86_400_000).toISOString().slice(0, 10);
  try {
    const res = await fetch(`https://api.frankfurter.dev/v1/${start}..${to}?base=${currency}&symbols=INR`, {
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const j = (await res.json()) as { rates?: Record<string, { INR?: number }> };
    const series: Record<string, number> = {};
    for (const [d, r] of Object.entries(j.rates ?? {})) if (r.INR) series[d] = r.INR;
    if (!Object.keys(series).length) throw new Error('no rates');
    fxCache.set(currency, { from: start, to, series });
    return series;
  } catch (e) {
    console.error(`[warehouse] FX ${currency}→INR failed:`, e);
    return null;
  }
}

// fx(currency, day) for a batch of (currency, day) pairs, fetched up front.
async function fxFor(need: Array<{ currency: string; day: string }>): Promise<(c: string, d: string) => number | null> {
  const ranges = new Map<string, { from: string; to: string }>();
  for (const { currency, day } of need) {
    if (currency === 'INR') continue;
    const r = ranges.get(currency);
    ranges.set(currency, { from: r && r.from < day ? r.from : day, to: r && r.to > day ? r.to : day });
  }
  const series = new Map<string, Record<string, number>>();
  for (const [c, r] of ranges) { const s = await fxSeries(c, r.from, r.to); if (s) series.set(c, s); }
  return (c, d) => (c === 'INR' ? 1 : series.has(c) ? rateOn(series.get(c)!, d) : null);
}

// ── Writing ─────────────────────────────────────────────────────────────────

const ORDER_COLS = [
  'order_id', 'store', 'name', 'created_at', 'cancelled_at', 'person_id', 'phone', 'email', 'currency', 'total',
  'total_inr', 'shop_currency', 'shop_total', 'discount_codes', 'payment_method', 'billing_name', 'shipping_name',
  'shipping_city', 'shipping_country', 'likely_gift', 'items', 'financial_status', 'fulfillment_status', 'is_test',
  'click_id', 'updated_at',
];
const RETURN_COLS = ['return_id', 'order_id', 'person_id', 'created_at', 'reason', 'items', 'source', 'status'];

// Rows go in as one JSON array (jsonb_populate_recordset), so a page is one statement.
async function writePage(orders: OrderRow[], returns: ReturnRow[]): Promise<void> {
  await tx(async (c) => {
    if (orders.length) {
      await c.query(
        `INSERT INTO orders (${ORDER_COLS.join(', ')}, synced_at)
         SELECT ${ORDER_COLS.join(', ')}, now() FROM jsonb_populate_recordset(null::orders, $1::jsonb)
         ON CONFLICT (order_id) DO UPDATE SET
           ${ORDER_COLS.slice(1).filter((k) => k !== 'total_inr').map((k) => `${k} = EXCLUDED.${k}`).join(', ')},
           -- an FX outage mustn't blank a conversion we already have for the same amount
           total_inr = CASE WHEN EXCLUDED.total_inr IS NULL AND EXCLUDED.shop_total = orders.shop_total
                            THEN orders.total_inr ELSE EXCLUDED.total_inr END,
           synced_at = now()`,
        [JSON.stringify(orders)],
      );
    }
    if (returns.length) {
      // A portal row written live by /api/returns keeps its exact request time.
      await c.query(
        `INSERT INTO returns (${RETURN_COLS.join(', ')})
         SELECT ${RETURN_COLS.join(', ')} FROM jsonb_populate_recordset(null::returns, $1::jsonb)
         ON CONFLICT (return_id) DO UPDATE SET
           order_id = EXCLUDED.order_id, person_id = EXCLUDED.person_id,
           created_at = CASE WHEN returns.source = 'portal' THEN returns.created_at ELSE EXCLUDED.created_at END,
           reason = COALESCE(EXCLUDED.reason, returns.reason), items = EXCLUDED.items,
           source = EXCLUDED.source, status = EXCLUDED.status`,
        [JSON.stringify(returns)],
      );
    }
  });
}

// Fills total_inr left empty by an earlier FX outage.
async function repairInr(store: Store): Promise<number> {
  const rows = await q<{ order_id: string; shop_currency: string; shop_total: string; day: string }>(
    `SELECT order_id, shop_currency, shop_total, to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day
     FROM orders WHERE store = $1 AND total_inr IS NULL AND shop_total IS NOT NULL AND shop_currency IS NOT NULL`,
    [store],
  );
  if (!rows?.length) return 0;
  const fx = await fxFor(rows.map((r) => ({ currency: r.shop_currency, day: r.day })));
  let n = 0;
  for (const r of rows) {
    const rate = fx(r.shop_currency, r.day);
    if (!rate) continue;
    const ok = await q('UPDATE orders SET total_inr = round($2::numeric * $3::numeric, 2) WHERE order_id = $1', [r.order_id, r.shop_total, rate]);
    if (ok) n++;
  }
  return n;
}

// ── Fetching ────────────────────────────────────────────────────────────────

// 20 orders × (25 lines + 3 returns × 10 lines) stays under Shopify's 1000-point
// single-query cost limit. More than 25 lines / 3 returns on one order is logged.
const PAGE = 20;
const ORDERS = /* GraphQL */ `
  query SyncOrders($q: String, $after: String) {
    orders(first: ${PAGE}, after: $after, query: $q, sortKey: UPDATED_AT) {
      edges { node {
        id name createdAt updatedAt cancelledAt test tags note email phone
        customAttributes { key value }
        paymentGatewayNames discountCodes displayFinancialStatus displayFulfillmentStatus
        totalPriceSet { shopMoney { amount currencyCode } presentmentMoney { amount currencyCode } }
        customer { displayName phone email }
        billingAddress { name city countryCodeV2 phone }
        shippingAddress { name city countryCodeV2 phone }
        lineItems(first: 25) {
          edges { node { title variantTitle quantity product { handle }
            originalUnitPriceSet { presentmentMoney { amount currencyCode } } } }
          pageInfo { hasNextPage }
        }
        returns(first: 3) { edges { node {
          id name status createdAt
          returnLineItems(first: 10) { edges { node {
            quantity returnReason returnReasonNote customerNote
            ... on ReturnLineItem { fulfillmentLineItem { lineItem { title variantTitle quantity product { handle }
              originalUnitPriceSet { presentmentMoney { amount currencyCode } } } } }
          } } }
        } } }
      } }
      pageInfo { hasNextPage endCursor }
    }
  }
`;
type OrdersPage = { orders: { edges: Array<{ node: OrderNode }>; pageInfo: { hasNextPage: boolean; endCursor: string | null } } };

export interface OrderSyncResult {
  store: Store;
  mode: 'full' | 'incremental';
  fetched: number;
  returns: number;
  deleted: number;
  inrRepaired: number;
  cursor: string | null;
  shopifyCount: number | null;   // Shopify's own order count, for parity
  mirrorCount: number | null;    // rows we hold for the store
  error?: string;
}

export async function syncOrders(store: Store, opts: { full?: boolean } = {}): Promise<OrderSyncResult> {
  const key = `orders:${store}`;
  const full = !!opts.full;
  let cursor = full ? null : await getCursor(key);
  const res: OrderSyncResult = {
    store, mode: full ? 'full' : 'incremental', fetched: 0, returns: 0, deleted: 0, inrRepaired: 0,
    cursor, shopifyCount: null, mirrorCount: null,
  };
  const seen: string[] = [];
  let after: string | null = null;
  const query = sinceQuery(cursor);

  try {
    // 2000 pages × 20 = 40,000 orders: only a runaway-loop guard, not a cap.
    for (let page = 0; page < 2000; page++) {
      const data: OrdersPage | null = await shopifyQuery<OrdersPage>(store, ORDERS, { q: query, after });
      if (!data) { res.error = `Shopify read failed on page ${page + 1}`; break; }
      const nodes = data.orders.edges.map((e) => e.node);
      if (nodes.length) {
        for (const n of nodes) {
          if (n.lineItems.pageInfo?.hasNextPage) console.warn(`[warehouse] ${store} ${n.name}: over 25 line items, items truncated`);
          if (n.returns.edges.length >= 3) console.warn(`[warehouse] ${store} ${n.name}: 3+ returns, later ones not read`);
        }
        const fx = await fxFor(nodes.map((n) => ({ currency: n.totalPriceSet.shopMoney.currencyCode, day: n.createdAt.slice(0, 10) })));
        const rows = nodes.map((n) => orderRow(store, n, fx));
        const rets = nodes.flatMap((n, i) => orderReturns(n, rows[i]));
        await writePage(rows, rets);
        // Oldest-updated first, so the last node is how far we've safely got.
        cursor = nodes[nodes.length - 1].updatedAt;
        await saveState(key, cursor);
        res.fetched += nodes.length;
        res.returns += rets.length;
        seen.push(...rows.map((r) => r.order_id));
      }
      if (!data.orders.pageInfo.hasNextPage) break;
      after = data.orders.pageInfo.endCursor;
    }

    // Only a complete full read can say an order is gone (deleted in Shopify).
    if (full && !res.error) {
      const gone = await q<{ order_id: string }>(
        'SELECT order_id FROM orders WHERE store = $1 AND NOT (order_id = ANY($2::text[]))', [store, seen],
      );
      const ids = (gone ?? []).map((r) => r.order_id);
      if (ids.length) {
        await tx(async (c) => {
          await c.query('DELETE FROM returns WHERE order_id = ANY($1::text[])', [ids]);
          await c.query('DELETE FROM orders WHERE order_id = ANY($1::text[])', [ids]);
        });
        res.deleted = ids.length;
      }
    }
    res.inrRepaired = await repairInr(store);
  } catch (e) {
    console.error(`[warehouse] orders sync (${store}) failed:`, e);
    res.error = e instanceof Error ? e.message : String(e);
  }

  res.cursor = cursor;
  const count = await shopifyQuery<{ ordersCount: { count: number } }>(store, '{ ordersCount(limit: null) { count } }');
  res.shopifyCount = count?.ordersCount?.count ?? null;
  const mine = await q<{ n: string }>('SELECT count(*) AS n FROM orders WHERE store = $1', [store]);
  res.mirrorCount = mine ? Number(mine[0].n) : null;
  await saveState(key, cursor, res);
  return res;
}

// ── Live return requests ────────────────────────────────────────────────────

// Called by /api/returns right after Shopify accepts a return request, so the row
// exists before the next sync (which then fills in full item detail under the same
// id — see portalReturnId). Never throws.
export async function recordReturnRequest(order: {
  id: string;
  email: string | null;
  phone: string | null;
  items: Array<{ title: string; quantity: number; price: { amount: string } | null }>;
}, reason: string): Promise<void> {
  try {
    const day = new Date().toISOString().slice(0, 10); // the date requestReturn writes in the note
    const items = order.items.map((i) => ({
      handle: null, title: i.title, variant: null, quantity: i.quantity, price: i.price ? Number(i.price.amount) : null,
    }));
    await q(
      `INSERT INTO returns (return_id, order_id, person_id, created_at, reason, items, source, status)
       VALUES ($1, $2, $3, now(), $4, $5::jsonb, 'portal', 'requested')
       ON CONFLICT (return_id) DO UPDATE SET reason = COALESCE(EXCLUDED.reason, returns.reason)`,
      [portalReturnId(order.id, day), order.id, personIdFor(order.phone, order.email) || null,
        reason.trim() || null, JSON.stringify(items)],
    );
  } catch (e) {
    console.error('[warehouse] recordReturnRequest failed:', e);
  }
}
