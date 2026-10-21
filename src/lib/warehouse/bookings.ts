// Try at Home + Private Viewing bookings → Neon `bookings`. Both are tagged DRAFT
// orders on the India store (createDemoBooking / createPrivateViewingBooking in
// shopify/admin.ts); this mirrors them like ./orders.ts mirrors orders: drafts updated
// since the last run, paginated to the end, upserted. `outcome` / `outcome_at` belong
// to staff (set in /admin) and are never written here. Never throws.
import { q } from '~/lib/db';
import { bookingRow, type BookingRow, type DraftNode } from './shopify-map';
import { getCursor, saveState, shopifyQuery, sinceQuery } from './orders';

const TAGS = '(tag:home-demo OR tag:private-viewing)';
const DRAFTS = /* GraphQL */ `
  query SyncBookings($q: String!, $after: String) {
    draftOrders(first: 50, after: $after, query: $q, sortKey: UPDATED_AT) {
      edges { node {
        id createdAt updatedAt status tags email phone
        customAttributes { key value }
        shippingAddress { city }
        lineItems(first: 15) { edges { node { title product { handle } } } }
      } }
      pageInfo { hasNextPage endCursor }
    }
  }
`;
type DraftsPage = {
  draftOrders: { edges: Array<{ node: DraftNode & { updatedAt: string } }>; pageInfo: { hasNextPage: boolean; endCursor: string | null } };
};

const COLS = ['booking_id', 'flow', 'person_id', 'created_at', 'date', 'slot', 'city', 'bags', 'status'];

async function write(rows: BookingRow[]): Promise<boolean> {
  if (!rows.length) return true;
  const ok = await q(
    `INSERT INTO bookings (${COLS.join(', ')}, synced_at)
     SELECT ${COLS.join(', ')}, now() FROM jsonb_populate_recordset(null::bookings, $1::jsonb)
     ON CONFLICT (booking_id) DO UPDATE SET
       ${COLS.slice(1).map((k) => `${k} = EXCLUDED.${k}`).join(', ')}, synced_at = now()`,
    [JSON.stringify(rows)],
  );
  return ok !== null;
}

export interface BookingSyncResult {
  mode: 'full' | 'incremental';
  fetched: number;
  missing: number;               // full only: rows whose draft is gone, marked 'deleted'
  cursor: string | null;
  shopifyCount: number | null;
  mirrorCount: number | null;
  error?: string;
}

export async function syncBookings(opts: { full?: boolean } = {}): Promise<BookingSyncResult> {
  const key = 'bookings:india';
  const full = !!opts.full;
  let cursor = full ? null : await getCursor(key);
  const res: BookingSyncResult = { mode: full ? 'full' : 'incremental', fetched: 0, missing: 0, cursor, shopifyCount: null, mirrorCount: null };
  const since = sinceQuery(cursor);
  const query = since ? `${TAGS} AND ${since}` : TAGS;
  const seen: string[] = [];
  let after: string | null = null;

  try {
    for (let page = 0; page < 1000; page++) { // runaway-loop guard, not a cap
      const data: DraftsPage | null = await shopifyQuery<DraftsPage>('india', DRAFTS, { q: query, after });
      if (!data) { res.error = `Shopify read failed on page ${page + 1}`; break; }
      const nodes = data.draftOrders.edges.map((e) => e.node);
      const rows = nodes.map(bookingRow).filter((r): r is BookingRow => !!r);
      if (!(await write(rows))) { res.error = 'database write failed'; break; }
      if (nodes.length) {
        cursor = nodes[nodes.length - 1].updatedAt;
        await saveState(key, cursor);
      }
      res.fetched += rows.length;
      seen.push(...rows.map((r) => r.booking_id));
      if (!data.draftOrders.pageInfo.hasNextPage) break;
      after = data.draftOrders.pageInfo.endCursor;
    }

    // A draft deleted in Shopify: keep the row (and any outcome staff recorded), flag it.
    if (full && !res.error) {
      const gone = await q<{ booking_id: string }>(
        `UPDATE bookings SET status = 'deleted', synced_at = now()
         WHERE status IS DISTINCT FROM 'deleted' AND NOT (booking_id = ANY($1::text[])) RETURNING booking_id`,
        [seen],
      );
      res.missing = gone?.length ?? 0;
    }
  } catch (e) {
    console.error('[warehouse] bookings sync failed:', e);
    res.error = e instanceof Error ? e.message : String(e);
  }

  res.cursor = cursor;
  const count = await shopifyQuery<{ draftOrdersCount: { count: number } }>(
    'india', `query($q: String!) { draftOrdersCount(query: $q, limit: null) { count } }`, { q: TAGS },
  );
  res.shopifyCount = count?.draftOrdersCount?.count ?? null;
  const mine = await q<{ n: string }>(`SELECT count(*) AS n FROM bookings WHERE status IS DISTINCT FROM 'deleted'`);
  res.mirrorCount = mine ? Number(mine[0].n) : null;
  await saveState(key, cursor, res);
  return res;
}
