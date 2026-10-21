// The /admin metrics contract: what GET /api/admin/metrics/{section} returns.
// The admin UI builds against these types only; the SQL behind them lives in
// db/migrations/002_metrics.sql and the per-section files next to this one.
//
// Conventions every section follows:
//  • Dates are IST calendar days, 'YYYY-MM-DD'. A range is inclusive at both ends.
//  • Every response covers `period` and compares with `previous`: the same number of
//    days immediately before it (1–7 Oct → 24–30 Sep).
//  • Bots and test people are excluded unless the request asks for them.
//  • A number is never bare. A headline number is a `Metric` (its own label, unit and
//    written definition); a table cell is a `Cell` whose label, unit and definition
//    are on the table's `Column`.
//  • Rates carry their parts (num/den) so the UI can show "3.1% (42 of 1,350)".
//    Medians carry `n`, the number of observations behind them.
//  • `smallSample` is true when the base of a rate (den) or a median (n) is under 30
//    — show "too few to judge" instead of drawing conclusions.
//  • Money is INR. Times are milliseconds. Rates are fractions (0.031 = 3.1%).

export type IstDate = string;

export type SectionName =
  | 'overview'
  | 'acquisition'
  | 'products'
  | 'checkout'
  | 'audience'
  | 'retention'
  | 'funnelDaily'
  | 'trackingHealth';

export type AcquisitionBy = 'source' | 'source_medium' | 'campaign' | 'content';
export type AttributionModel = 'last' | 'first';

// What every section takes. `by` / `model` are read by `acquisition` only.
export interface MetricsParams {
  from: IstDate;
  to: IstDate;
  includeBots: boolean;
  includeTest: boolean;
  by?: AcquisitionBy;          // default 'source'
  model?: AttributionModel;    // default 'last'
}

export interface Period {
  from: IstDate;
  to: IstDate;
  days: number;
}

// 'rate' = a fraction 0–1; 'ratio' = a multiple (ROAS 3.2 = ₹3.20 back per ₹1).
export type Unit = 'count' | 'inr' | 'ms' | 'rate' | 'ratio' | 'days' | 'pct';

// One number for the current period, with the same number for the previous period.
export interface Cell {
  value: number | null;      // null = can't be computed (no data, or a base of 0)
  num?: number;              // rates: value = num / den
  den?: number;
  n?: number;                // medians: how many observations
  prev: number | null;       // the same metric over the previous period
  prevNum?: number;
  prevDen?: number;
  smallSample: boolean;      // den (or n) < 30
}

// A headline number: a Cell that carries its own label and definition.
export interface Metric extends Cell {
  key: string;
  label: string;
  unit: Unit;
  definition: string;        // shown on hover; one written meaning per metric
}

export interface Column {
  key: string;
  label: string;
  unit: Unit;
  definition: string;
}

// A comparison table (channels, products, devices…). Rows are sorted by the first
// column, descending, unless a section says otherwise. A row that only existed in
// the previous period is kept, with value 0/null and its prev filled in.
export interface Table<K> {
  columns: Column[];
  rows: TableRow<K>[];
}

export interface TableRow<K> {
  key: K;
  label: string;
  cells: Record<string, Cell>;
}

export type ValueKey = { value: string };

export interface SectionMeta {
  section: SectionName;
  period: Period;
  previous: Period;
  filters: { includeBots: boolean; includeTest: boolean };
  generatedAt: string;       // ISO timestamp
  notes: string[];           // caveats worth showing under the section
}

// A step of a funnel: how many people reached it, and what share of the step before.
export interface FunnelStep extends Metric {
  fromPrevious: Cell | null; // null on the first step
}

// ── Overview ────────────────────────────────────────────────────────────────

export interface TrendPoint {
  day: IstDate;
  legacy: boolean;           // from the old Firestore counters
  visitors: number | null;   // null on legacy days (the old counters had no such number)
  sessions: number | null;
  orders: number;
  revenueInr: number;
}

export interface OverviewResponse extends SectionMeta {
  section: 'overview';
  kpis: {
    visitors: Metric;
    newVisitors: Metric;
    returningVisitors: Metric;
    sessions: Metric;
    engagedSessionRate: Metric;
    medianEngagedPerSession: Metric;
    orders: Metric;
    revenue: Metric;
    medianOrderValue: Metric;
    conversionRate: Metric;
  };
  funnel: FunnelStep[];      // visitors → viewed a product → cart → checkout → payment → ordered
  trend: TrendPoint[];       // current period, one point per IST day, oldest first
}

// ── Acquisition ─────────────────────────────────────────────────────────────

export interface AcquisitionKey {
  source?: string;
  medium?: string;
  campaign?: string;
  content?: string;
}

export interface AcquisitionResponse extends SectionMeta {
  section: 'acquisition';
  by: AcquisitionBy;
  model: AttributionModel;
  spendAvailable: boolean;   // any ad spend in the period (cost columns are null otherwise)
  // Columns: sessions, visitors, leads, leadRate, orders, revenue, conversionRate,
  // spend, costPerSale, roas (the last three only when `by` is campaign or content).
  table: Table<AcquisitionKey>;
}

// ── Products ────────────────────────────────────────────────────────────────

export interface ProductsResponse extends SectionMeta {
  section: 'products';
  // key.value = Shopify handle; label = title when an order line named it, else handle.
  // Columns: views, viewers, medianEngagedMs, medianGalleryDepth, medianScroll,
  // addToCartRate, orders, units, revenue, soldOutViews. Sorted by views.
  table: Table<ValueKey>;
}

// ── Checkout ────────────────────────────────────────────────────────────────

export interface CheckoutResponse extends SectionMeta {
  section: 'checkout';
  // cart → checkout opened → OTP sent → OTP verified → phone → address → payment
  // method → payment opened → payment succeeded → ordered (people at each step).
  steps: FunnelStep[];
  kpis: {
    otpFailureRate: Metric;
    paymentFailureRate: Metric;
  };
  otpFailures: Table<ValueKey>;       // by reason: events, people, share (of events)
  paymentFailures: Table<ValueKey>;   // by reason: events, people, share (of events)
  paymentMethods: Table<ValueKey>;    // by method: events, people, share (of events)
  coupons: Table<ValueKey>;           // by code: tries, valid, invalid
}

// ── Audience ────────────────────────────────────────────────────────────────

export type OwnDimension = 'device' | 'os' | 'browser' | 'city' | 'country';
export type GaDimension = 'age' | 'gender' | 'interest';

export interface GaBreakdown {
  available: boolean;        // false → show "not enough data" (GA hides small groups)
  note: string | null;
  table: Table<ValueKey>;    // users, share, sessions, conversions
}

export interface AudienceResponse extends SectionMeta {
  section: 'audience';
  // From our own visits, joinable to orders. Columns: visitors, share, sessions,
  // medianEngagedMs, buyers, conversionRate. Top 20 values per dimension.
  own: Record<OwnDimension, Table<ValueKey>>;
  // From Google Analytics (nightly sync). Columns: users, share, sessions, conversions.
  ga: Record<GaDimension, GaBreakdown>;
}

// ── Retention ───────────────────────────────────────────────────────────────

export interface CohortRow {
  cohortWeek: IstDate;       // Monday of the IST week the cohort was first seen
  size: number;
  weeks: { weeksSince: number; active: Cell; buyers: Cell }[];  // rates of `size`; prev is null
}

export interface RetentionResponse extends SectionMeta {
  section: 'retention';
  kpis: {
    returningVisitorShare: Metric;
    repeatPurchaseRate: Metric;
    medianDaysToFirstOrder: Metric;
    medianSessionsToFirstOrder: Metric;
  };
  // Cohorts first seen in the period, weeks 0–12. Not compared with a previous period.
  cohorts: CohortRow[];
}

// ── Daily funnel ────────────────────────────────────────────────────────────

export interface FunnelDayRow {
  day: IstDate;
  legacy: boolean;
  // null = not measured that day (legacy days lack some columns).
  visitors: number | null;
  newVisitors: number | null;
  returningVisitors: number | null;
  sessions: number | null;
  p1: number | null;
  p2: number | null;
  p3: number | null;
  cart: number | null;
  checkoutStart: number | null;
  phone: number | null;
  address: number | null;
  paymentStart: number | null;
  orders: number;
  revenueInr: number;
}

export interface FunnelDailyResponse extends SectionMeta {
  section: 'funnelDaily';
  columns: Column[];         // definitions for every FunnelDayRow number
  rows: FunnelDayRow[];      // one per IST day of the period, newest first
  // Period totals vs the previous period: the first-time milestones, sessions,
  // orders and revenue (they add up across days; visitors don't, so they're absent).
  totals: Metric[];
}

// ── Tracking health ─────────────────────────────────────────────────────────

export interface HealthDay {
  day: IstDate;
  events: number;
  botEvents: number;
  pageViews: number;
  rejects: number;
  orders: number;
}

export interface TrackingHealthResponse extends SectionMeta {
  section: 'trackingHealth';
  kpis: {
    events: Metric;
    rejectRate: Metric;
    botShare: Metric;
    daysWithoutPageViews: Metric;
  };
  days: HealthDay[];                  // one per IST day of the period, newest first
  rejectReasons: Table<ValueKey>;     // rejected payloads by reason
  eventNames: Table<ValueKey>;        // events received by name
}

export interface SectionResponses {
  overview: OverviewResponse;
  acquisition: AcquisitionResponse;
  products: ProductsResponse;
  checkout: CheckoutResponse;
  audience: AudienceResponse;
  retention: RetentionResponse;
  funnelDaily: FunnelDailyResponse;
  trackingHealth: TrackingHealthResponse;
}

export type SectionResponse = SectionResponses[SectionName];

// Error body for 400 / 401 / 404 / 500 / 503.
export interface MetricsError {
  error: string;
}
