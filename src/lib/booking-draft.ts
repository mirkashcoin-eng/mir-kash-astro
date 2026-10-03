// What a visitor typed into the Try at Home / Private Viewing booking wizards,
// remembered on their own device so a reload doesn't lose it.
//
// Modeled on src/lib/checkout-draft.ts (same versioned, fail-silent localStorage
// shape) but kept separate from it — checkout's draft deliberately survives a
// completed order (so the next one arrives pre-filled) and has its own tests. A
// booking is a one-off appointment: this draft is cleared on a successful submit,
// so a later visit never silently resumes a past date/slot.
import type { WizardStep } from './booking-wizard';

export const DRAFT_KEY_TRY_AT_HOME = 'mk_tryhome_draft';
export const DRAFT_KEY_PRIVATE_VIEWING = 'mk_privateviewing_draft';

const VERSION = 1;

export interface BookingBag {
  variantId: string;
  title: string;
}

export interface BookingDraft {
  step: WizardStep;
  dateISO: string;
  dateLabel: string;
  slot: string;
  bags: BookingBag[];
  fields: Partial<Record<string, string>>;
}

interface Stored extends BookingDraft {
  v: number;
  at: string;
}

// Storage can throw (Safari Private Browsing, storage-partitioned in-app webviews)
// or be entirely absent. Losing the draft is never worth breaking the booking flow
// — every path here fails silently, same discipline as checkout-draft.ts.
export function saveDraft(key: string, draft: BookingDraft): void {
  try {
    const payload: Stored = { v: VERSION, at: new Date().toISOString(), ...draft };
    localStorage.setItem(key, JSON.stringify(payload));
  } catch {
    /* storage unavailable or full — the form still works, it just won't be remembered */
  }
}

export function loadDraft(key: string): BookingDraft | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Stored>;
    // A draft written by an older shape isn't worth migrating — dropping it costs
    // re-picking a date; restoring it wrong could submit a stale appointment.
    if (parsed?.v !== VERSION || typeof parsed.fields !== 'object' || !parsed.fields) return null;
    return {
      step: typeof parsed.step === 'string' ? (parsed.step as WizardStep) : 'cover',
      dateISO: typeof parsed.dateISO === 'string' ? parsed.dateISO : '',
      dateLabel: typeof parsed.dateLabel === 'string' ? parsed.dateLabel : '',
      slot: typeof parsed.slot === 'string' ? parsed.slot : '',
      bags: Array.isArray(parsed.bags) ? parsed.bags : [],
      fields: parsed.fields,
    };
  } catch {
    return null;
  }
}

export function clearDraft(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    /* nothing to do */
  }
}
