// What the buyer typed on /checkout, remembered on their own device.
//
// The checkout keeps everything in DOM state and in-memory variables, so any refresh
// wipes it — including the reloads the page triggers itself (removing a line item, a
// rejected coupon, and previously right after signing in). A buyer who typed a full
// address and tapped "Sign in" lost the lot.
//
// Deliberately localStorage and not the server. `window.mkLead` already ships phone +
// address to Firestore keyed on `mk_sid` (see lib/leads.ts), but reading it back would
// need a public GET, and anyone who guessed or stole an `mk_sid` could pull a
// stranger's home address. Same convenience on the same device, none of that exposure.
//
// Kept after the order is placed, on purpose: the next order arrives pre-filled without
// the buyer needing an account. Cleared only by clearDraft() (a shared-device escape
// hatch), never on a failed payment — that is exactly when they need it back.

const KEY = 'mk_checkout_draft';
const VERSION = 1;

// Every field worth remembering. `waOptin` is a checkbox and `f-state` a <select>;
// both are handled by the caller, which knows how to read each element.
export const DRAFT_FIELDS = [
  'f-name',
  'f-email',
  'f-phone',
  'f-addr',
  'f-apt',
  'f-city',
  'f-state',
  'f-pin',
] as const;

export interface CheckoutDraft {
  fields: Partial<Record<string, string>>;
  waOptin: boolean;
  pay: string; // 'upi' | 'card' | 'cod'
}

interface Stored extends CheckoutDraft {
  v: number;
  at: string;
}

// Storage can throw (Safari Private Browsing, storage-partitioned in-app webviews) or
// be entirely absent. Losing the draft is never worth breaking checkout, so every path
// here fails silently — the buyer just types their address like they do today.
export function saveDraft(draft: CheckoutDraft): void {
  try {
    const payload: Stored = { v: VERSION, at: new Date().toISOString(), ...draft };
    localStorage.setItem(KEY, JSON.stringify(payload));
  } catch {
    /* storage unavailable or full — the form still works, it just won't be remembered */
  }
}

export function loadDraft(): CheckoutDraft | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Stored>;
    // A draft written by an older shape isn't worth migrating — dropping it costs one
    // re-typed address; restoring it wrong could put a stale value on a live order.
    if (parsed?.v !== VERSION || typeof parsed.fields !== 'object' || !parsed.fields) return null;
    return {
      fields: parsed.fields,
      waOptin: parsed.waOptin !== false,
      pay: typeof parsed.pay === 'string' ? parsed.pay : '',
    };
  } catch {
    return null;
  }
}

export function clearDraft(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* nothing to do */
  }
}
