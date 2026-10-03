// When the cart's "Before you go" panel may appear, remembered on the visitor's own device.
// Same versioned, fail-silent storage discipline as viewing-prompt.ts.
//
// It asks once and then leaves people alone: at most once per visit, never after they've
// gone on to checkout in this visit, and quiet for two weeks after they answer or close it.

export const CX_KEY = 'mk_cx';
export const CX_SHOWN_KEY = 'mk_cx_shown';       // sessionStorage: shown this visit
export const CX_CHECKOUT_KEY = 'mk_cx_checkout'; // sessionStorage: went to checkout this visit

const VERSION = 1;
const DAY = 86_400_000;
export const CX_QUIET_MS = 14 * DAY;

// Phones: this much visible time on the cart without checking out also counts as hesitating.
export const CX_LINGER_MS = 45_000;
// Desktop exit intent counts only after this long on the page.
export const CX_EXIT_MIN_MS = 10_000;
// The booking pages take at most this many bags.
export const MAX_BAGS = 6;

export interface CxState { answeredAt?: number; dismissedAt?: number }
type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

export function readCx(storage: StorageLike | null | undefined): CxState {
  try {
    const raw = storage?.getItem(CX_KEY);
    if (!raw) return {};
    const p = JSON.parse(raw);
    if (p?.v !== VERSION) return {};
    return { answeredAt: num(p.answeredAt), dismissedAt: num(p.dismissedAt) };
  } catch {
    return {};
  }
}

export function markCx(storage: StorageLike | null | undefined, field: keyof CxState, now: number): void {
  try {
    storage?.setItem(CX_KEY, JSON.stringify({ ...readCx(storage), [field]: now, v: VERSION }));
  } catch { /* storage unavailable — the panel may show again, which is harmless */ }
}

const flag = (session: StorageLike | null | undefined, key: string): boolean => {
  try { return session?.getItem(key) === '1'; } catch { return false; }
};
const setFlag = (session: StorageLike | null | undefined, key: string): void => {
  try { session?.setItem(key, '1'); } catch { /* nothing to do */ }
};
export const shownCxThisVisit = (s: StorageLike | null | undefined) => flag(s, CX_SHOWN_KEY);
export const markCxShown = (s: StorageLike | null | undefined) => setFlag(s, CX_SHOWN_KEY);
export const checkoutStartedThisVisit = (s: StorageLike | null | undefined) => flag(s, CX_CHECKOUT_KEY);
export const markCheckoutStarted = (s: StorageLike | null | undefined) => setFlag(s, CX_CHECKOUT_KEY);

export function canShowCx(state: CxState, shownThisVisit: boolean, checkoutThisVisit: boolean, now: number): boolean {
  if (shownThisVisit || checkoutThisVisit) return false;
  const last = Math.max(state.answeredAt ?? 0, state.dismissedAt ?? 0);
  return !last || now - last >= CX_QUIET_MS;
}

// `?bags=a,b,c` (and the older single `?bag=a`) → clean, de-duplicated handles, at most MAX_BAGS.
export function parseBags(bags: string | null | undefined, bag?: string | null): string[] {
  const all = [...String(bags ?? '').split(','), String(bag ?? '')]
    .map((h) => h.trim().toLowerCase())
    .filter((h) => /^[a-z0-9][a-z0-9-]*$/.test(h));
  return [...new Set(all)].slice(0, MAX_BAGS);
}
