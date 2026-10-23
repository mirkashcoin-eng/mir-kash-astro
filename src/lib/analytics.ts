// Shapes and sums for the Try at Home view's counter panels (booking prompt, cart "Before
// you go", Try at Home page steps, phone banner test). The counts come from Neon — see
// ./warehouse/panels.ts, which builds the daily docs these functions add up. Counter names
// are the ones the old Firestore `analytics_daily` docs used (th_view, th_view_ad, vp_shown_home …).

// The funnel stages, in order. `purchase` is sourced from Shopify orders (authoritative),
// so it is not a tracked event here.
export const FUNNEL_EVENTS = ['visit', 'product_view', 'add_to_cart', 'checkout_start', 'payment_start'] as const;
export type FunnelEvent = (typeof FUNNEL_EVENTS)[number];

// Day bucket in India time so a "day" matches the store's day.
function dayKey(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }); // YYYY-MM-DD
}

// Booking-prompt (Try at Home / Private Viewing dialog) counters, in the same daily doc.
// Per event: a total plus a split by page kind and by offer, e.g. vp_shown, vp_shown_home,
// vp_shown_tryhome. They are impressions, not unique people: the prompt itself shows at most
// once per visit per page kind. `total` is untouched so the visitor funnel is unaffected.
export const PROMPT_EVENTS = ['vp_shown', 'vp_dismiss', 'vp_click'] as const;
export type PromptEvent = (typeof PROMPT_EVENTS)[number];
export const PROMPT_PAGES = ['home', 'shop', 'product'] as const;
export const PROMPT_OFFERS = ['tryhome', 'viewing'] as const;

export interface PromptCounts { shown: number; dismiss: number; click: number }
export interface PromptStats {
  days: number;
  all: PromptCounts;
  byPage: Record<(typeof PROMPT_PAGES)[number], PromptCounts>;
  byOffer: Record<(typeof PROMPT_OFFERS)[number], PromptCounts>;
}

// Summed over the last `days` daily docs. null if unavailable, so /admin can degrade.
export function promptFromDocs(docs: DayDoc[], days: number): PromptStats {
  const zero = (): PromptCounts => ({ shown: 0, dismiss: 0, click: 0 });
  const out: PromptStats = {
    days, all: zero(),
    byPage: { home: zero(), shop: zero(), product: zero() },
    byOffer: { tryhome: zero(), viewing: zero() },
  };
  for (const { data: v } of docs) {
    const add = (c: PromptCounts, suffix: string) => {
      c.shown += Number(v[`vp_shown${suffix}`] || 0);
      c.dismiss += Number(v[`vp_dismiss${suffix}`] || 0);
      c.click += Number(v[`vp_click${suffix}`] || 0);
    };
    add(out.all, '');
    for (const p of PROMPT_PAGES) add(out.byPage[p], `_${p}`);
    for (const o of PROMPT_OFFERS) add(out.byOffer[o], `_${o}`);
  }
  return out;
}

// Cart "Before you go" panel counters, in the same daily doc. Per event: a total plus an
// optional split by offer, e.g. cx_shown, cx_shown_tryhome. Impressions, not unique people.
// `total` is untouched so the visitor funnel is unaffected.
export const CART_EXIT_EVENTS = [
  'cx_shown', 'cx_dismiss',
  'cx_reason_seeit', 'cx_reason_size', 'cx_reason_price', 'cx_reason_looking',
  'cx_book_click', 'cx_saved', 'cx_checkout_click',
] as const;
export type CartExitEvent = (typeof CART_EXIT_EVENTS)[number];
export const CART_EXIT_OFFERS = ['tryhome', 'viewing'] as const;

export type CartExitCounts = Record<CartExitEvent, number>;
export interface CartExitStats {
  days: number;
  counts: CartExitCounts;
  byOffer: Record<(typeof CART_EXIT_OFFERS)[number], CartExitCounts>;
}

// Summed over the last `days` daily docs. null if unavailable, so /admin can degrade.
export function cartExitFromDocs(docs: DayDoc[], days: number): CartExitStats {
  const zero = (): CartExitCounts =>
    Object.fromEntries(CART_EXIT_EVENTS.map((e) => [e, 0])) as CartExitCounts;
  const out: CartExitStats = { days, counts: zero(), byOffer: { tryhome: zero(), viewing: zero() } };
  for (const { data: v } of docs) {
    for (const e of CART_EXIT_EVENTS) {
      out.counts[e] += Number(v[e] || 0);
      for (const o of CART_EXIT_OFFERS) out.byOffer[o][e] += Number(v[`${e}_${o}`] || 0);
    }
  }
  return out;
}

// Try at Home page funnel, in the same daily doc: how many reached each step, so /admin
// can show where people drop off. The page sends each step at most once per browser per
// day (see BookDemo.astro), so these read as daily unique visitors, not page loads.
// Each count also has an `_ad` twin for visitors who arrived from a Meta ad. `total` is
// untouched so the shop funnel is unaffected.

// One day's counters, as the Firestore daily doc held them: flat numeric fields such as
// th_view, th_view_ad, th_view_abA, vp_shown_home. The Neon-backed panels (see
// lib/warehouse/panels.ts) build the same shape, so both sources share the sums below.
export interface DayDoc { id: string; data: Record<string, number> }

export const TRY_AT_HOME_EVENTS = ['th_view', 'th_quickview', 'th_pick', 'th_datetime', 'th_details', 'th_phone', 'th_submit', 'th_booked'] as const;
export type TryAtHomeEvent = (typeof TRY_AT_HOME_EVENTS)[number];

export type TryAtHomeCounts = Record<TryAtHomeEvent, number>;
export interface TryAtHomeStats {
  days: number;
  all: TryAtHomeCounts;
  ad: TryAtHomeCounts;
  // Newest first, only days anyone reached the page.
  daily: Array<{ day: string; all: TryAtHomeCounts }>;
}

// Summed over the last `days` daily docs, plus each day on its own. null if
// unavailable, so /admin can degrade.
export function tryAtHomeFromDocs(docs: DayDoc[], days: number): TryAtHomeStats {
  const zero = (): TryAtHomeCounts =>
    Object.fromEntries(TRY_AT_HOME_EVENTS.map((e) => [e, 0])) as TryAtHomeCounts;
  const out: TryAtHomeStats = { days, all: zero(), ad: zero(), daily: [] };
  for (const { id, data: v } of docs) {
    const day = zero();
    for (const e of TRY_AT_HOME_EVENTS) {
      day[e] = Number(v[e] || 0);
      out.all[e] += day[e];
      out.ad[e] += Number(v[`${e}_ad`] || 0);
    }
    if (day.th_view) out.daily.push({ day: String((v as { day?: unknown }).day || id), all: day });
  }
  return out;
}

// Phone banner test totals per version since it started (the first day either version
// was counted), from the `_abA` / `_abB` twins above. Reads up to `days` daily docs.
export interface BannerTestCounts { A: TryAtHomeCounts; B: TryAtHomeCounts; firstDay: string | null; days: number }

export function bannerFromDocs(docs: DayDoc[], days: number): BannerTestCounts {
  const zero = (): TryAtHomeCounts =>
    Object.fromEntries(TRY_AT_HOME_EVENTS.map((e) => [e, 0])) as TryAtHomeCounts;
  const out: BannerTestCounts = { A: zero(), B: zero(), firstDay: null, days: 0 };
  for (const { id, data: v } of docs) {
    if (!v.th_view_abA && !v.th_view_abB) continue;
    for (const e of TRY_AT_HOME_EVENTS) {
      out.A[e] += Number(v[`${e}_abA`] || 0);
      out.B[e] += Number(v[`${e}_abB`] || 0);
    }
    const day = String((v as { day?: unknown }).day || id);
    if (!out.firstDay || day < out.firstDay) out.firstDay = day;
  }
  if (out.firstDay) {
    const today = dayKey();
    out.days = Math.round((Date.parse(today) - Date.parse(out.firstDay)) / 864e5) + 1;
  }
  return out;
}
