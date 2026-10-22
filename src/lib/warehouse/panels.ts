// The Try at Home view's counter panels (page funnel, phone banner test, booking prompt,
// cart "Before you go"), read from Neon instead of the Firestore analytics_daily counters.
//
// Two sources are merged day by day:
//   - legacy_daily (source 'analytics_daily'): the Firestore counters copied over by
//     scripts/migrate-firestore.mjs, which cover every day up to the migration;
//   - events: the same steps logged by the new tracker (th_*, vp_*, cx_*), which cover
//     everything since it went live.
// The two overlap on a few days, and each undercounts that day (the copy stops when the
// migration ran, the event log starts when the new tracker did). So per day and per
// counter the larger of the two wins, which never double counts and never loses a count.
//
// Counters keep the Firestore field names (th_view, th_view_ad, th_view_abA, vp_shown_home,
// cx_shown_tryhome …) so the sums in ./analytics.ts are shared by both sources.
import { q } from '~/lib/db';
import {
  bannerFromDocs, cartExitFromDocs, promptFromDocs, tryAtHomeFromDocs,
  type BannerTestCounts, type CartExitStats, type DayDoc, type PromptStats, type TryAtHomeStats,
} from '~/lib/analytics';

const IST = 'Asia/Kolkata';
const PAGES = ['home', 'shop', 'product'];
const OFFERS = ['tryhome', 'viewing'];

// How far back the widest panel (banner test) reaches; the others take the last 30 days.
const LOOKBACK_DAYS = 120;
const RECENT_DAYS = 30;

interface LegacyRow { day: string; metric: string; value: string }
interface EventRow {
  day: string; name: string;
  n: string; u: string; n_ad: string; u_ad: string; n_a: string; u_a: string; n_b: string; u_b: string;
  n_page: string[]; n_offer: string[];
}

const num = (v: unknown) => Number(v) || 0;

/** Daily counter docs for the last `days` days, newest first; null when Neon is unavailable. */
export async function neonDayDocs(days = LOOKBACK_DAYS): Promise<DayDoc[] | null> {
  const since = `((now() AT TIME ZONE '${IST}')::date - $1::int)`;
  const legacy = await q<LegacyRow>(
    `SELECT to_char(day, 'YYYY-MM-DD') AS day, metric, value::text
       FROM legacy_daily
      WHERE source = 'analytics_daily' AND day >= ${since}`,
    [days - 1],
  );
  const events = await q<EventRow>(
    `SELECT to_char(day, 'YYYY-MM-DD') AS day, name,
            count(*)::text AS n, count(DISTINCT visitor_id)::text AS u,
            count(*) FILTER (WHERE src = 'ad')::text AS n_ad,
            count(DISTINCT visitor_id) FILTER (WHERE src = 'ad')::text AS u_ad,
            count(*) FILTER (WHERE ab = 'A')::text AS n_a,
            count(DISTINCT visitor_id) FILTER (WHERE ab = 'A')::text AS u_a,
            count(*) FILTER (WHERE ab = 'B')::text AS n_b,
            count(DISTINCT visitor_id) FILTER (WHERE ab = 'B')::text AS u_b,
            ARRAY[${PAGES.map((p) => `count(*) FILTER (WHERE page = '${p}')::text`).join(', ')}] AS n_page,
            ARRAY[${OFFERS.map((o) => `count(*) FILTER (WHERE offer = '${o}')::text`).join(', ')}] AS n_offer
       FROM (SELECT (e.ts AT TIME ZONE '${IST}')::date AS day, e.name, e.visitor_id,
                    e.props->>'src' AS src, e.props->>'ab' AS ab,
                    e.props->>'page' AS page, e.props->>'offer' AS offer
               FROM events e
               JOIN visitors v ON v.visitor_id = e.visitor_id
              WHERE e.name ~ '^(th|vp|cx)_' AND NOT e.is_bot AND NOT v.is_bot AND NOT v.is_test
                AND (e.ts AT TIME ZONE '${IST}')::date >= ${since}) t
      GROUP BY day, name`,
    [days - 1],
  );
  if (!legacy || !events) return null;

  const byDay = new Map<string, Record<string, number>>();
  const put = (day: string, field: string, n: number, how: 'set' | 'max') => {
    let d = byDay.get(day);
    if (!d) byDay.set(day, (d = {}));
    d[field] = how === 'max' ? Math.max(d[field] ?? 0, n) : n;
  };
  for (const r of legacy) put(r.day, r.metric, num(r.value), 'set');
  for (const r of events) {
    // Try at Home steps are once per browser per day, so unique visitors; the prompt and
    // cart panels count impressions (the same as the old counters did).
    const th = r.name.startsWith('th_');
    const pick = (n: string, u: string) => num(th ? u : n);
    put(r.day, r.name, pick(r.n, r.u), 'max');
    put(r.day, `${r.name}_ad`, pick(r.n_ad, r.u_ad), 'max');
    put(r.day, `${r.name}_abA`, pick(r.n_a, r.u_a), 'max');
    put(r.day, `${r.name}_abB`, pick(r.n_b, r.u_b), 'max');
    PAGES.forEach((p, i) => put(r.day, `${r.name}_${p}`, num(r.n_page[i]), 'max'));
    OFFERS.forEach((o, i) => put(r.day, `${r.name}_${o}`, num(r.n_offer[i]), 'max'));
  }
  return [...byDay.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([id, data]) => ({ id, data }));
}

export interface TryAtHomePanels {
  tryAtHome: TryAtHomeStats;
  bannerCounts: BannerTestCounts;
  prompt: PromptStats;
  cartExit: CartExitStats;
}

/** The four counter panels from Neon, or null so the caller can fall back to Firestore. */
export async function getTryAtHomePanels(): Promise<TryAtHomePanels | null> {
  const docs = await neonDayDocs(LOOKBACK_DAYS);
  if (!docs) return null;
  const recent = docs.filter((d) => d.id >= daysAgoIST(RECENT_DAYS - 1));
  return {
    tryAtHome: tryAtHomeFromDocs(recent, RECENT_DAYS),
    bannerCounts: bannerFromDocs(docs, LOOKBACK_DAYS),
    prompt: promptFromDocs(recent, RECENT_DAYS),
    cartExit: cartExitFromDocs(recent, RECENT_DAYS),
  };
}

function daysAgoIST(n: number): string {
  const t = new Date(Date.now() + 5.5 * 3600e3 - n * 864e5);
  return t.toISOString().slice(0, 10);
}
