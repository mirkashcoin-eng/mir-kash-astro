// Self-check for the shared booking-wizard step engine.
// Run: node src/lib/booking-wizard.test.mjs
import assert from 'node:assert/strict';

// Mirrors src/lib/booking-wizard.ts (kept inline, not imported, so this runs on
// plain Node without a TypeScript loader — same convention as checkout-draft.test.mjs).
// Bags before date/time, deliberately — see booking-wizard.ts for why.
const WIZARD_STEPS = ['cover', 'bags', 'datetime', 'details'];
const stepIndex = (s) => WIZARD_STEPS.indexOf(s);
const nextStep = (s) => WIZARD_STEPS[Math.min(stepIndex(s) + 1, WIZARD_STEPS.length - 1)];
const prevStep = (s) => WIZARD_STEPS[Math.max(stepIndex(s) - 1, 0)];
function canAdvance(step, ctx) {
  switch (step) {
    case 'cover': return { ok: true };
    case 'bags':
      if (ctx.bagCount < 1) return { ok: false, reason: 'Please select at least one bag.' };
      if (ctx.bagCount > 6) return { ok: false, reason: 'Please remove a bag — up to 6 at a time.' };
      return { ok: true };
    case 'datetime': return ctx.hasDateTime ? { ok: true } : { ok: false, reason: 'Please choose a day and a time.' };
    case 'details': return ctx.detailsValid ? { ok: true } : { ok: false, reason: 'Please check the details above.' };
  }
}
function resolveInitialStep(ctx) {
  for (const step of WIZARD_STEPS) {
    if (step === 'cover') continue;
    if (!canAdvance(step, ctx).ok) return step;
  }
  return WIZARD_STEPS[WIZARD_STEPS.length - 1];
}

// ── Order + boundary clamping ──
assert.deepEqual(WIZARD_STEPS, ['cover', 'bags', 'datetime', 'details']);
assert.equal(stepIndex('datetime'), 2);
assert.equal(nextStep('details'), 'details', 'must not run past the last step');
assert.equal(prevStep('cover'), 'cover', 'must not run before the first step');
assert.equal(nextStep('cover'), 'bags');
assert.equal(prevStep('details'), 'datetime');

// ── canAdvance gates ──
assert.equal(canAdvance('cover', { hasDateTime: false, bagCount: 0, detailsValid: false }).ok, true, 'cover is always free to leave');

assert.equal(canAdvance('bags', { hasDateTime: false, bagCount: 0, detailsValid: false }).ok, false, '0 bags must block');
assert.equal(canAdvance('bags', { hasDateTime: false, bagCount: 1, detailsValid: false }).ok, true);
assert.equal(canAdvance('bags', { hasDateTime: false, bagCount: 6, detailsValid: false }).ok, true);
assert.equal(canAdvance('bags', { hasDateTime: false, bagCount: 7, detailsValid: false }).ok, false, '7 bags must block');

assert.equal(canAdvance('datetime', { hasDateTime: false, bagCount: 1, detailsValid: false }).ok, false);
assert.equal(canAdvance('datetime', { hasDateTime: true, bagCount: 1, detailsValid: false }).ok, true);

assert.equal(canAdvance('details', { hasDateTime: true, bagCount: 1, detailsValid: false }).ok, false);
assert.equal(canAdvance('details', { hasDateTime: true, bagCount: 1, detailsValid: true }).ok, true);

// ── resolveInitialStep (mirrors advanceFromFilledFields in CheckoutPage.astro) ──
assert.equal(resolveInitialStep({ hasDateTime: false, bagCount: 0, detailsValid: false }), 'bags', 'empty draft resolves to the first real step');
assert.equal(resolveInitialStep({ hasDateTime: false, bagCount: 2, detailsValid: false }), 'datetime');
assert.equal(resolveInitialStep({ hasDateTime: true, bagCount: 2, detailsValid: false }), 'details');
assert.equal(resolveInitialStep({ hasDateTime: true, bagCount: 2, detailsValid: true }), 'details', 'a fully complete draft opens at the last step, not past it');
// Never skip a step Continue itself would reject.
assert.equal(resolveInitialStep({ hasDateTime: true, bagCount: 7, detailsValid: true }), 'bags', 'an invalid bag count must not skip past bags');
assert.equal(resolveInitialStep({ hasDateTime: false, bagCount: 2, detailsValid: true }), 'datetime', 'missing datetime must not skip to details just because later steps look filled');

console.log('booking-wizard self-check: all assertions passed');
