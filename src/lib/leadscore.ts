// Lead score: "who is most likely to buy if we reach out today?", as a number from
// 0 to 100 that anyone can add up by hand, plus a one-line reason in plain words
// ("₹18k cart · 3rd visit · gave phone yesterday").
//
// Pure — no database, no `~/` imports — so `node src/lib/leadscore.test.mjs` can
// import it directly. The SAME weights also build the SQL expression (scoreSql) the
// People list sorts by and the Action inbox filters on, so the number on screen and
// the order of the list can never disagree.
//
// ── How the score is made (points add up to 100) ─────────────────────────────
//
//   Cart value (latest cart)   up to 30   ₹25k+ 30 · ₹15k+ 24 · ₹8k+ 18 · ₹3k+ 10 · any 5
//   Last seen                  up to 20   today 20 · ≤3 days 15 · ≤7 days 10 · ≤14 days 5 · ≤30 days 2
//   Gave a phone number              10   we can actually reach them
//   Visits                     up to 10   4+ visits 10 · 3rd visit 8 · 2nd visit 5
//   Time spent (engaged)       up to 10   10 min+ 10 · 5 min+ 7 · 2 min+ 4 · 30 s+ 1
//   Started a booking                 8   Try at Home / Private Viewing, any step
//   Bags looked at             up to  6   4+ bags 6 · 2–3 bags 4 · 1 bag 2
//   Reached checkout                  6   opened checkout / OTP / payment
//
// Interest fades: if they were last here more than 30 days ago the total is halved,
// more than 90 days ago it is quartered.
//
// Not a lead at all (no score): bots, test numbers, and anyone who already ordered
// after their last add-to-cart (they bought what they wanted).

export const HOT_THRESHOLD = 50;   // Action inbox lists people at or above this
export const HANDLED_DAYS = 7;     // …unless someone on the team handled them this recently

// [at least this much, points] — first match wins, so highest first.
export const CART_BANDS: Array<[number, number]> = [[25000, 30], [15000, 24], [8000, 18], [3000, 10], [0.01, 5]];
// [seen within this many days, points]
export const RECENCY_BANDS: Array<[number, number]> = [[1, 20], [3, 15], [7, 10], [14, 5], [30, 2]];
export const VISIT_BANDS: Array<[number, number]> = [[4, 10], [3, 8], [2, 5]];
export const ENGAGED_MIN_BANDS: Array<[number, number]> = [[10, 10], [5, 7], [2, 4], [0.5, 1]];
export const PRODUCT_BANDS: Array<[number, number]> = [[4, 6], [2, 4], [1, 2]];
export const PHONE_POINTS = 10;
export const BOOKING_POINTS = 8;
export const CHECKOUT_POINTS = 6;
// [last seen more than this many days ago, multiplier] — first match wins.
export const FADE: Array<[number, number]> = [[90, 0.25], [30, 0.5]];

// Rough rates so an international cart can be weighed against Indian ones. Only
// used to pick a cart band, never shown as money.
export const FX_TO_INR: Record<string, number> = { INR: 1, USD: 85, EUR: 92, GBP: 108, AED: 23, SGD: 64, CAD: 61, AUD: 56 };

export interface LeadInput {
  cart_value: number | string | null;
  cart_currency?: string | null;
  last_seen: string | Date | null;
  visits: number | string | null;
  engaged_ms: number | string | null;
  products_viewed: number | string | null;
  phone_given: boolean;
  phone_at?: string | Date | null;
  booking_started: boolean;
  booking_flow?: string | null;
  checkout_reached: boolean;
  last_cart_at?: string | Date | null;
  last_order_at?: string | Date | null;
  orders?: number | string | null;
  is_bot?: boolean;
  is_test?: boolean;
}

const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''));
  return Number.isFinite(n) ? n : 0;
};
const time = (v: string | Date | null | undefined): number | null => {
  if (v == null) return null;
  const t = v instanceof Date ? v.getTime() : new Date(v).getTime();
  return Number.isFinite(t) ? t : null;
};
const atLeast = (x: number, bands: Array<[number, number]>): number => {
  for (const [min, pts] of bands) if (x >= min) return pts;
  return 0;
};

export function cartInr(p: Pick<LeadInput, 'cart_value' | 'cart_currency'>): number {
  const rate = FX_TO_INR[String(p.cart_currency || 'INR').toUpperCase()] ?? 1;
  return Math.max(0, num(p.cart_value)) * rate;
}

// Why someone isn't scored, or null when they are.
export function notALead(p: LeadInput): string | null {
  if (p.is_bot) return 'Bot';
  if (p.is_test) return 'Test number';
  if (num(p.orders) > 0) {
    const cart = time(p.last_cart_at), order = time(p.last_order_at);
    if (cart == null || (order != null && order >= cart)) return 'Already ordered';
  }
  return null;
}

// The score, 0–100, or null when the person isn't a lead (see notALead).
export function leadScore(p: LeadInput, now: Date | number = Date.now()): number | null {
  if (notALead(p)) return null;
  const nowMs = typeof now === 'number' ? now : now.getTime();
  const seen = time(p.last_seen);
  const days = seen == null ? null : (nowMs - seen) / 864e5;

  let pts = atLeast(cartInr(p), CART_BANDS);
  if (days != null) for (const [within, r] of RECENCY_BANDS) if (days < within) { pts += r; break; }
  if (p.phone_given) pts += PHONE_POINTS;
  pts += atLeast(num(p.visits), VISIT_BANDS);
  pts += atLeast(num(p.engaged_ms) / 60000, ENGAGED_MIN_BANDS);
  if (p.booking_started) pts += BOOKING_POINTS;
  pts += atLeast(num(p.products_viewed), PRODUCT_BANDS);
  if (p.checkout_reached) pts += CHECKOUT_POINTS;

  if (days != null) for (const [over, m] of FADE) if (days > over) { pts *= m; break; }
  return Math.round(pts);
}

// ── The score, itemised ──────────────────────────────────────────────────────

export interface ScorePart {
  key: string;
  label: string;     // what was looked at
  detail: string;    // what this person did, in words
  points: number;    // earned
  max: number;       // the most this line can give
}
export interface ScoreBreakdown {
  score: number | null;        // same number leadScore() returns
  notALead: string | null;     // why there is no score, when there isn't
  parts: ScorePart[];          // one line per signal, in the order of the table in the header comment
  subtotal: number;            // sum of the parts, before fading
  fade: { factor: number; note: string } | null;
}

const top = (b: Array<[number, number]>) => Math.max(...b.map(([, p]) => p));

// Every line of the score with the points this person earned, so the screen can show
// the sum. Built from the same bands as leadScore(), and the test checks they agree.
export function scoreBreakdown(p: LeadInput, now: Date | number = Date.now()): ScoreBreakdown {
  const no = notALead(p);
  const nowMs = typeof now === 'number' ? now : now.getTime();
  const seen = time(p.last_seen);
  const days = seen == null ? null : (nowMs - seen) / 864e5;
  const cart = cartInr(p);
  const visits = num(p.visits);
  const mins = num(p.engaged_ms) / 60000;
  const bags = num(p.products_viewed);

  let recency = 0;
  if (days != null) for (const [within, r] of RECENCY_BANDS) if (days < within) { recency = r; break; }

  const parts: ScorePart[] = [
    { key: 'cart', label: 'Bag in the cart', max: top(CART_BANDS), points: atLeast(cart, CART_BANDS),
      detail: cart > 0 ? `${inrShort(cart)} in the latest cart` : 'Nothing in a cart' },
    { key: 'recency', label: 'How recently they were here', max: top(RECENCY_BANDS), points: recency,
      detail: seen == null ? 'Not known' : `Last seen ${whenIst(p.last_seen, nowMs)}` },
    { key: 'phone', label: 'Gave a phone number', max: PHONE_POINTS, points: p.phone_given ? PHONE_POINTS : 0,
      detail: p.phone_given ? 'Yes, so you can contact them' : 'No' },
    { key: 'visits', label: 'Number of visits', max: top(VISIT_BANDS), points: atLeast(visits, VISIT_BANDS),
      detail: visits >= 2 ? `${ordinal(visits)} visit` : 'First visit' },
    { key: 'time', label: 'Time spent on the site', max: top(ENGAGED_MIN_BANDS), points: atLeast(mins, ENGAGED_MIN_BANDS),
      detail: mins >= 1 ? `${Math.round(mins)} min in total` : 'Under a minute' },
    { key: 'booking', label: 'Started a booking', max: BOOKING_POINTS, points: p.booking_started ? BOOKING_POINTS : 0,
      detail: p.booking_started ? `Started ${FLOW[p.booking_flow || ''] || 'a booking'}` : 'No' },
    { key: 'bags', label: 'Bags looked at', max: top(PRODUCT_BANDS), points: atLeast(bags, PRODUCT_BANDS),
      detail: bags === 1 ? '1 bag' : `${bags} bags` },
    { key: 'checkout', label: 'Opened checkout', max: CHECKOUT_POINTS, points: p.checkout_reached ? CHECKOUT_POINTS : 0,
      detail: p.checkout_reached ? 'Yes' : 'No' },
  ];
  const subtotal = parts.reduce((s, x) => s + x.points, 0);
  let fade: ScoreBreakdown['fade'] = null;
  if (days != null) for (const [over, m] of FADE) if (days > over) { fade = { factor: m, note: `Last seen over ${over} days ago, so the total is ${m === 0.5 ? 'halved' : 'quartered'}` }; break; }
  return { score: no ? null : leadScore(p, nowMs), notALead: no, parts, subtotal, fade };
}

// ── The one-line reason ──────────────────────────────────────────────────────

// ₹950 · ₹8.5k · ₹18k · ₹1.2L
export function inrShort(n: number): string {
  if (n >= 1e5) return `₹${(n / 1e5).toFixed(1).replace(/\.0$/, '')}L`;
  if (n >= 1e4) return `₹${Math.round(n / 1000)}k`;
  if (n >= 1000) return `₹${(Math.round(n / 100) / 10).toString().replace(/\.0$/, '')}k`;
  return `₹${Math.round(n)}`;
}

export function ordinal(n: number): string {
  const s = n % 100 >= 11 && n % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] || 'th';
  return `${n}${s}`;
}

const IST_MS = 5.5 * 3600e3;
const istDay = (ms: number) => Math.floor((ms + IST_MS) / 864e5);

// "today" · "yesterday" · "3 days ago" · "on 12 Oct" — calendar days in IST.
export function whenIst(t: string | Date | null | undefined, now: Date | number = Date.now()): string {
  const ms = time(t);
  if (ms == null) return '';
  const nowMs = typeof now === 'number' ? now : now.getTime();
  const d = istDay(nowMs) - istDay(ms);
  if (d <= 0) return 'today';
  if (d === 1) return 'yesterday';
  if (d < 7) return `${d} days ago`;
  const ist = new Date(ms + IST_MS);
  const mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][ist.getUTCMonth()];
  return `on ${ist.getUTCDate()} ${mon}`;
}

const FLOW: Record<string, string> = { try_at_home: 'Try at Home', private_viewing: 'Private Viewing' };

// Up to four short facts, strongest signal first.
export function leadReason(p: LeadInput, now: Date | number = Date.now()): string {
  const no = notALead(p);
  if (no) return no;
  const parts: string[] = [];
  const cart = cartInr(p);
  if (cart > 0) parts.push(`${inrShort(cart)} cart`);
  const visits = num(p.visits);
  if (visits >= 2) parts.push(`${ordinal(visits)} visit`);
  if (p.booking_started) parts.push(`started ${FLOW[p.booking_flow || ''] || 'a booking'}`);
  if (p.phone_given) {
    const w = whenIst(p.phone_at, now);
    parts.push(w ? `gave phone ${w}` : 'gave phone');
  } else if (p.checkout_reached) parts.push('reached checkout');
  const mins = Math.round(num(p.engaged_ms) / 60000);
  if (parts.length < 3 && mins >= 2) parts.push(`${mins} min browsing`);
  const bags = num(p.products_viewed);
  if (parts.length < 3 && bags >= 2) parts.push(`viewed ${bags} bags`);
  if (!p.phone_given && p.last_seen) parts.push(`seen ${whenIst(p.last_seen, now)}`);
  return parts.slice(0, 4).join(' · ') || 'Browsed once';
}

// ── The same score in SQL ────────────────────────────────────────────────────

// SQL expression for the score of a row of mv_people / v_people aliased `a`.
// `now` is any SQL timestamptz expression (default now()). NULL = not a lead.
// Written so each row does only cheap comparisons on raw columns (timestamps
// against intervals, ms against ms) — it is evaluated for every row on a sort.
export function scoreSql(a = 'p', now = 'now()'): string {
  const bands = (x: string, b: Array<[number, number]>, scale = 1) =>
    `CASE ${b.map(([v, pts]) => `WHEN ${x} >= ${v * scale} THEN ${pts}`).join(' ')} ELSE 0 END`;
  const ms = (days: number) => `(${now}) - interval '${days * 86400} seconds'`;
  // Rupee carts (almost all) compare directly; other currencies convert in their branch.
  const cart = `CASE upper(COALESCE(${a}.cart_currency, 'INR')) ${Object.entries(FX_TO_INR)
    .filter(([c]) => c !== 'INR')
    .map(([c, r]) => `WHEN '${c}' THEN ${bands(`${a}.cart_value * ${r}`, CART_BANDS)}`).join(' ')}
    ELSE ${bands(`${a}.cart_value`, CART_BANDS)} END`;
  const total = [
    `COALESCE(${cart}, 0)`,
    `CASE ${RECENCY_BANDS.map(([d, pts]) => `WHEN ${a}.last_seen > ${ms(d)} THEN ${pts}`).join(' ')} ELSE 0 END`,
    `CASE WHEN ${a}.phone_given THEN ${PHONE_POINTS} ELSE 0 END`,
    bands(`${a}.visits`, VISIT_BANDS),
    bands(`${a}.engaged_ms`, ENGAGED_MIN_BANDS, 60000),
    `CASE WHEN ${a}.booking_started THEN ${BOOKING_POINTS} ELSE 0 END`,
    bands(`${a}.products_viewed`, PRODUCT_BANDS),
    `CASE WHEN ${a}.checkout_reached THEN ${CHECKOUT_POINTS} ELSE 0 END`,
  ].map((s) => `(${s})`).join(' + ');
  const fade = `CASE ${FADE.map(([d, m]) => `WHEN ${a}.last_seen < ${ms(d)} THEN ${m}`).join(' ')} ELSE 1 END`;
  const excluded = `${a}.is_bot OR ${a}.is_test OR (${a}.orders > 0 AND (${a}.last_cart_at IS NULL OR ${a}.last_order_at >= ${a}.last_cart_at))`;
  return `(CASE WHEN ${excluded} THEN NULL ELSE round((${total}) * (${fade}))::int END)`;
}
