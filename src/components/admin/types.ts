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

// ── Action inbox (from GET /api/admin/inbox) ─────────────────────────────────
export type InboxKind = 'hot_lead' | 'payment_failed' | 'booking_confirm' | 'restock';
export interface InboxItem {
  id: string;                     // kind + ':' + ref (DOM key)
  kind: InboxKind;
  ref: string;                    // what POST /api/admin/inbox marks done
  title: string;
  detail: string;                 // the API's one-line reason
  value: number | null;           // INR at stake, when there is one
  whatsapp: string | null;        // wa.me link with an opener
  personId: string | null;        // opens the People drawer
  createdAt: string | null;
  outcomes: string[];             // suggested outcomes for "Done"
}
export interface InboxGroup { key: InboxKind; title: string; items: InboxItem[]; }
export interface InboxData { total: number; asOf: string | null; hotThreshold: number | null; groups: InboxGroup[]; }

// ── People (from GET /api/admin/people) ──────────────────────────────────────
export type Stage = 'visited' | 'viewed' | 'cart' | 'checkout' | 'phone' | 'address' | 'payment' | 'ordered';
export type PeopleSort = 'last_seen' | 'first_seen' | 'score' | 'value' | 'cart' | 'visits';
export interface PeopleQuery {
  q?: string;
  stage?: Stage | 'returning' | 'all';
  source?: string;                // first- or last-touch source, exact (e.g. instagram)
  device?: string;                // mobile | tablet | desktop
  city?: string;
  kind?: 'person' | 'visitor';
  minScore?: number;
  sort?: PeopleSort;
  page?: number;
  /** Any other param the API understands. */
  extra?: Record<string, string>;
}
export interface PersonRow {
  id: string;
  kind: 'person' | 'visitor';
  name: string;                   // name, else phone, else email, else "Visitor"
  phone: string | null;
  email: string | null;
  location: string;               // city (plus country outside India)
  stage: Stage;
  visits: number;
  returning: boolean;
  source: string;                 // first touch, e.g. "Instagram · diwali"
  lastSource: string;
  device: string;
  timeOnSiteMin: number | null;
  cartValue: number | null;
  cartCurrency: string | null;
  score: number | null;
  reason: string;                 // lead reason, or why not a lead ("Already ordered")
  orders: number;
  ltv: number;
  products: string[];
  firstSeen: string | null;
  lastSeen: string | null;
  bookingFlow: string | null;
  bookings: number;
  daysToFirstPurchase: number | null;
  whatsapp: string | null;
  isTest: boolean;
}
export interface PeopleList { count: number; total: number; returning: number; page: number; pages: number; size: number; asOf: string | null; rows: PersonRow[]; }
export interface TimelineStep { at: string; text: string; sub?: string; kind: 'visit' | 'event' | 'order' | 'booking'; }
export interface HandledAction { at: string; by: string; outcome: string; note: string | null; kind: string; }
export interface PersonDetail {
  id: string;
  row: PersonRow | null;          // null: new since the People copy was built
  name: string;
  phone: string | null;
  email: string | null;
  whatsapp: string | null;
  address: string | null;
  firstSeen: string | null;
  counts: { visits: number; events: number; orders: number; bookings: number };
  handled: HandledAction[];
  timeline: TimelineStep[];       // newest first
}
export interface RefreshState { status: 'running' | 'done' | 'failed'; asOf: string | null; }

// ── Fetch results ────────────────────────────────────────────────────────────
export type Result<T> = { ok: true; data: T } | { ok: false; status: number; error: string };
