// Pure step-engine shared by the Try at Home and Private Viewing booking wizards
// (src/components/BookDemo.astro, src/components/PrivateViewing.astro). No DOM, no
// storage — just step order, navigation, and the gating rules for "can Continue
// leave this step", so both wizards drive the same four full-screen steps from one
// place instead of two hand-copied state machines.

// Bags before date/time, deliberately: picking which pieces to see is the
// engaging, "shopping" choice — it builds investment before the logistics ask
// (when) and the friction ask (who you are), which is the standard order for
// maximizing completion on a flow with one fun step and one effortful step.
export const WIZARD_STEPS = ['cover', 'bags', 'datetime', 'details'] as const;
export type WizardStep = (typeof WIZARD_STEPS)[number];

export function stepIndex(step: WizardStep): number {
  return WIZARD_STEPS.indexOf(step);
}

export function nextStep(step: WizardStep): WizardStep {
  const i = stepIndex(step);
  return WIZARD_STEPS[Math.min(i + 1, WIZARD_STEPS.length - 1)];
}

export function prevStep(step: WizardStep): WizardStep {
  const i = stepIndex(step);
  return WIZARD_STEPS[Math.max(i - 1, 0)];
}

export interface GateContext {
  hasDateTime: boolean;
  bagCount: number;
  detailsValid: boolean;
}

export interface GateResult {
  ok: boolean;
  reason?: string;
}

// What must be true to leave `step` via Continue. `cover` is always free to leave;
// `details` isn't gated here at all — its own form validation (10-digit phone vs.
// E.164, address vs. city/country) differs per flow and is the wrapper's job.
export function canAdvance(step: WizardStep, ctx: GateContext): GateResult {
  switch (step) {
    case 'cover':
      return { ok: true };
    case 'bags':
      if (ctx.bagCount < 1) return { ok: false, reason: 'Please select at least one bag.' };
      if (ctx.bagCount > 6) return { ok: false, reason: 'Please remove a bag — up to 6 at a time.' };
      return { ok: true };
    case 'datetime':
      return ctx.hasDateTime ? { ok: true } : { ok: false, reason: 'Please choose a day and a time.' };
    case 'details':
      return ctx.detailsValid ? { ok: true } : { ok: false, reason: 'Please check the details above.' };
  }
}

// Where a resumed session should land: the furthest step reachable without ever
// skipping past one Continue itself would reject. Mirrors advanceFromFilledFields
// in CheckoutPage.astro — never jump to `details` on a draft with 7 bags recorded,
// for instance; land on `bags` instead, same as a live Continue click would.
// Deliberately never resolves to `cover` even with an otherwise-empty draft — the
// caller only invokes this when a real draft exists, and should keep cover as the
// explicit starting point for a draft-free visit instead.
export function resolveInitialStep(ctx: GateContext): WizardStep {
  for (const step of WIZARD_STEPS) {
    if (step === 'cover') continue;
    if (!canAdvance(step, ctx).ok) return step;
  }
  // Every gate passed — land on the last step, not past it (mirrors Checkout: "a
  // complete draft opens at payment, not step 1" — payment is its last step too).
  return WIZARD_STEPS[WIZARD_STEPS.length - 1];
}
