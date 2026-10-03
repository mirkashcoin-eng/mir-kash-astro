// When the Try at Home / Private Viewing prompt may appear, remembered on the visitor's
// own device. Same versioned, fail-silent storage discipline as booking-draft.ts.
//
// The prompt is a light touch, not a nag: at most once per visit per group of pages (browsing
// pages = homepage + Shop All share one allowance; product pages have their own, so a visitor
// can see it once while browsing and once on a bag), quiet for a week after it's dismissed, for a
// month after its link is followed, and never again once the visitor has booked either service
// (BookDemo / PrivateViewing write `bookedAt`). Dismissals and clicks are remembered per group,
// so closing it on the homepage doesn't silence product pages. A booking silences everything.

export const PROMPT_KEY = 'mk_vp';
export const SESSION_KEY = 'mk_vp_shown'; // + '_' + page

const VERSION = 1;
const DAY = 86_400_000;
export const DISMISS_QUIET_MS = 7 * DAY;
export const CLICK_QUIET_MS = 30 * DAY;

// Product page: this much visible time on the page, AND scrolled past the buy area.
export const PRODUCT_DWELL_MS = 40_000;
// Desktop exit intent counts only after this much visible time — not on a bounce.
export const EXIT_INTENT_MIN_MS = 15_000;

export type PromptPage = 'home' | 'shop' | 'product';
// The unit the frequency rules apply to. Homepage and Shop All count as one.
export type PromptGroup = 'browse' | 'product';
export const groupOf = (page: PromptPage): PromptGroup => (page === 'product' ? 'product' : 'browse');

export interface PromptState {
  dismissedAt?: number;
  clickedAt?: number;
  bookedAt?: number;
}
export type PromptMark = keyof PromptState;

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

// Stored as { v: 1, bookedAt?, pages?: { home?: {dismissedAt?, clickedAt?}, product?: {...} } }.
// The booking pages (BookDemo's inline script) rewrite this object when v === 1, so keep
// it additive and keep the version at 1.
function readRaw(storage: StorageLike | null | undefined): Record<string, any> {
  try {
    const raw = storage?.getItem(PROMPT_KEY);
    if (!raw) return {};
    const p = JSON.parse(raw);
    return p?.v === VERSION && typeof p === 'object' ? p : {};
  } catch {
    return {};
  }
}

// What applies to one kind of page: its own dismissal/click, plus the global booking.
export function readState(storage: StorageLike | null | undefined, page: PromptPage): PromptState {
  const p = readRaw(storage);
  const pg = p.pages?.[groupOf(page)] ?? {};
  return { dismissedAt: num(pg.dismissedAt), clickedAt: num(pg.clickedAt), bookedAt: num(p.bookedAt) };
}

// `bookedAt` is global; `dismissedAt` / `clickedAt` need the page they happened on.
export function mark(storage: StorageLike | null | undefined, field: PromptMark, now: number, page?: PromptPage): void {
  try {
    const p = readRaw(storage);
    if (field === 'bookedAt' || !page) p[field] = now;
    else { const g = groupOf(page); p.pages = { ...p.pages, [g]: { ...p.pages?.[g], [field]: now } }; }
    storage?.setItem(PROMPT_KEY, JSON.stringify({ ...p, v: VERSION }));
  } catch {
    /* storage unavailable — the prompt may show again, which is harmless */
  }
}

export function shownThisSession(session: StorageLike | null | undefined, page: PromptPage): boolean {
  try { return session?.getItem(`${SESSION_KEY}_${groupOf(page)}`) === '1'; } catch { return false; }
}

export function markShownThisSession(session: StorageLike | null | undefined, page: PromptPage): void {
  try { session?.setItem(`${SESSION_KEY}_${groupOf(page)}`, '1'); } catch { /* nothing to do */ }
}

export function canShow(state: PromptState, sessionShown: boolean, now: number): boolean {
  if (sessionShown || state.bookedAt) return false;
  if (state.dismissedAt && now - state.dismissedAt < DISMISS_QUIET_MS) return false;
  if (state.clickedAt && now - state.clickedAt < CLICK_QUIET_MS) return false;
  return true;
}

// Product page: someone who has studied the bag but not committed to it, or who has read
// all the way to the bottom (the component only reports `atBottom` after a short linger).
export function productReady(s: { dwellMs: number; pastBuyArea: boolean; exitIntent: boolean; atBottom: boolean; buying: boolean }): boolean {
  if (s.buying) return false;
  if (s.atBottom) return true;
  if (s.exitIntent && s.dwellMs >= EXIT_INTENT_MIN_MS) return true;
  return s.pastBuyArea && s.dwellMs >= PRODUCT_DWELL_MS;
}
