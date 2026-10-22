// View-model types for the /admin dashboard.
//
// Metrics sections render the API's own response types (src/lib/metrics/types.ts —
// type-only imports, nothing from the server is bundled). People and the Action inbox
// are mapped to the view-models below by mapping.ts.
export type {
  AcquisitionBy, AcquisitionKey, AcquisitionResponse, AttributionModel, AudienceResponse, Cell, CheckoutResponse,
  CohortRow, Column, FunnelDailyResponse, FunnelDayRow, FunnelStep, GaBreakdown, Metric, OverviewResponse,
  Period, ProductsResponse, RetentionResponse, SectionMeta, Table, TableRow, TrackingHealthResponse, TrendPoint,
  Unit, ValueKey,
} from '~/lib/metrics/types';

/** One line on the trend chart (built from OverviewResponse.trend). */
export interface SeriesPoint { day: string; value: number | null; legacy?: boolean; prev?: number | null; prevDay?: string; }
export interface Series { label: string; unit: import('~/lib/metrics/types').Unit; points: SeriesPoint[]; }

export type HealthStatus = 'healthy' | 'degraded' | 'unknown';
/** The header pill, derived from TrackingHealthResponse. */
export interface TrackingHealth {
  status: HealthStatus;
  label: string;
  checks: { label: string; ok: boolean; detail: string; definition?: string }[];
  notes: string[];
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
export type Stage = 'visited' | 'viewed' | 'cart' | 'phone' | 'address' | 'payment' | 'ordered';
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
export interface PeopleList {
  count: number; total: number; returning: number; page: number; pages: number; size: number; asOf: string | null; rows: PersonRow[];
  /** People at each step (the furthest one reached), under the current filters but not the step itself. */
  stages: Record<Stage, number>;
}
export interface ScorePartView { key: string; label: string; detail: string; points: number; max: number; }
/** The points behind one person's score, from scoreBreakdown() in src/lib/leadscore.ts. */
export interface ScoreView { score: number | null; notALead: string | null; parts: ScorePartView[]; subtotal: number; fade: { factor: number; note: string } | null; }
export interface TimelineStep { at: string; text: string; sub?: string; kind: 'visit' | 'event' | 'order' | 'booking'; }
export interface HandledAction { at: string; by: string; outcome: string; note: string | null; kind: string; }
export interface BrowsedPage { path: string; views: number; lastAt: string | null; engagedSec: number; maxScroll: number }
export interface BrowsedBag { handle: string; views: number; soldOutViews: number; cartAdds: number; lastAt: string | null; engagedSec: number }
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
  score: ScoreView | null;        // null: new since the People copy was built
  timeline: TimelineStep[];       // newest first
  browsed: { pages: BrowsedPage[]; bags: BrowsedBag[] };
}
export interface RefreshState { status: 'running' | 'done' | 'failed'; asOf: string | null; }

// ── Fetch results ────────────────────────────────────────────────────────────
export type Result<T> = { ok: true; data: T } | { ok: false; status: number; error: string };
