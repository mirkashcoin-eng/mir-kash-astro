// View-model types for the /admin dashboard. The UI renders ONLY these shapes;
// data.ts is the one place that maps endpoint responses (or demo fixtures) onto them.
// When the real /api/admin/metrics/* shapes land, change the normalisers in data.ts,
// not the views.

export type Unit = 'count' | 'pct' | 'inr' | 'minutes' | 'seconds' | 'days' | 'ratio';

/** One number with its meaning. Mirrors the API's `{ value, num?, den?, prev, definition, smallSample }`. */
export interface Metric {
  key: string;
  label: string;
  unit: Unit;
  value: number | null;
  num?: number;          // numerator, for rates ("822 of 12,840")
  den?: number;          // denominator
  prev: number | null;   // same metric over the previous period (null = no comparison)
  definition: string;
  smallSample: boolean;  // base < 30: show "too few to judge"
  /** Optional extra line, e.g. "Median order ₹11,900." or "Goal 1.5%". */
  note?: string;
  goal?: number;         // target in the metric's own unit (progress bar)
  /** Drill-down: People list filter this number opens (query for the People view). */
  drill?: PeopleQuery;
  /** For metrics where a drop is good (e.g. failure rate): flips arrow semantics. */
  lowerIsBetter?: boolean;
}

export interface SeriesPoint { day: string; value: number; prev?: number | null; }
export interface Series { label: string; unit: Unit; points: SeriesPoint[]; }

export interface FunnelStep {
  key: string;
  label: string;
  count: number;
  /** Share of the step before it (null for the first step). */
  ofPrev: number | null;
  drill?: PeopleQuery;
}

export interface Funnel { steps: FunnelStep[]; leak?: string; }

// ── Section models ────────────────────────────────────────────────────────────

export interface ChannelRow {
  source: string;
  visitors: number;
  orders: number;
  revenue: number;
  /** Cost per sale in rupees; null when there is no spend to divide (organic / direct). */
  costPerSale: number | null;
  costNote?: string;     // e.g. "₹300 commission"
  drill?: PeopleQuery;
}

export interface CampaignRow {
  campaign: string;
  source: string;
  visitors: number;
  carts: number;
  orders: number;
  revenue: number;
  spend: number | null;
  roas: number | null;
}

export interface OverviewData {
  metrics: Metric[];             // visitors, returning, cart rate, orders, revenue, median order…
  trend: Series[];               // selectable series (revenue, orders, visitors)
  funnel: Funnel;
  channels: ChannelRow[];
}

export interface AcquisitionData {
  channels: ChannelRow[];
  campaigns: CampaignRow[];
  landingPages: { page: string; visitors: number; orders: number }[];
}

export interface ProductRow {
  title: string;
  views: number;
  viewers: number;
  carts: number;
  orders: number;
  medianViewSeconds: number | null;
  soldOut?: boolean;
  longLooks?: number;            // people who looked longer than a minute
}
export interface ProductsData {
  rows: ProductRow[];
  soldOutDemand: { title: string; views: number; longLooks: number }[];
  zeroResultSearches: { term: string; count: number }[];
}

export interface CheckoutData {
  metrics: Metric[];
  funnel: Funnel;
  failures: { reason: string; count: number }[];
  paymentMix: { label: string; count: number }[];
}

export interface Share { label: string; share: number; count?: number; hidden?: boolean; }
export interface AudienceData {
  newReturning: { new: { visitors: number; orders: number }; returning: { visitors: number; orders: number } };
  device: { label: string; visitors: number; orders: number }[];
  cities: { city: string; visitors: number; orders: number }[];
  browsers: Share[];
  gift: Metric;
  /** Google Analytics demographics. `available:false` => Google Signals off / not enough data. */
  ga: {
    available: boolean;
    note?: string;
    age: Share[];
    gender: Share[];
    interests: string[];
  };
}

export interface RetentionData {
  metrics: Metric[];
  /** Weekly cohorts. weeks[i] = share (0..1) active i weeks after first visit; null = not elapsed yet. */
  cohorts: { cohort: string; size: number; weeks: (number | null)[] }[];
}

export type HealthStatus = 'healthy' | 'degraded' | 'down' | 'unknown';
export interface TrackingHealth {
  status: HealthStatus;
  label: string;                  // "Tracking healthy · orders match Shopify"
  checks: { label: string; ok: boolean; detail: string }[];
}

// ── Action inbox ─────────────────────────────────────────────────────────────
export interface InboxAction { kind: 'whatsapp' | 'link' | 'done' | 'person'; label: string; href?: string; }
export interface InboxItem {
  id: string;
  title: string;
  detail: string;
  score?: number;
  personId?: string;
  actions: InboxAction[];
  note?: string;                  // e.g. "No number to contact"
  bar?: number;                   // 0..100, sold-out demand strength
}
export interface InboxGroup { key: string; title: string; items: InboxItem[]; }
export interface InboxData { total: number; groups: InboxGroup[]; }

// ── People ───────────────────────────────────────────────────────────────────
export type Stage = 'visited' | 'viewed' | 'cart' | 'phone' | 'address' | 'payment' | 'ordered';
export interface PeopleQuery {
  q?: string;
  stage?: Stage | 'returning' | 'all';
  source?: string;
  device?: string;
  page?: number;
  /** Free-form extra filter the API understands, e.g. { channel: 'Instagram · paid' }. */
  extra?: Record<string, string>;
}
export interface PersonRow {
  id: string;
  name: string;                   // "Visitor" when unknown
  location: string;
  contact: string;                // masked phone or "no contact yet"
  stage: Stage;
  visits: number;
  returning: boolean;
  source: string;
  device: string;
  timeOnSiteMin: number | null;
  cartValue: number | null;
  score: number | null;
  ordered: boolean;
  isTest?: boolean;
}
export interface PeopleList { total: number; returning: number; page: number; pageSize: number; rows: PersonRow[]; }
export interface TimelineStep { at: string; text: string; sub?: string; }
export interface PersonDetail {
  row: PersonRow;
  summary: string;
  phone?: string;
  email?: string;
  firstSeen: string;
  firstCame: string;
  lastCame: string;
  deviceLine: string;
  timeOnSite: string;
  sections: { title: string; rows?: [string, string][]; text?: string; lines?: { title: string; sub?: string; qty: string; total: string }[] }[];
  timeline: TimelineStep[];
  /** Legacy source person, when the detail came from /api/admin/data. */
  legacyIndex?: number;
}

// ── Fetch results ────────────────────────────────────────────────────────────
export type Result<T> = { ok: true; data: T } | { ok: false; status: number; error: string };
