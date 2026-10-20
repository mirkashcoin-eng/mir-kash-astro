// Self-check for the shared booking-wizard step engine.
// Run: node src/lib/booking-wizard.test.mjs
import assert from 'node:assert/strict';

// Mirrors src/lib/booking-wizard.ts (kept inline, not imported, so this runs on
// plain Node without a TypeScript loader — same convention as checkout-draft.test.mjs).
// Bags before date/time, deliberately — see booking-wizard.ts for why.
const WIZARD_STEPS = ['cover', 'bags', 'datetime', 'details'];
const TRY_AT_HOME_STEPS = ['bags', 'datetime', 'details'];
const stepIndex = (s, steps = WIZARD_STEPS) => steps.indexOf(s);
const nextStep = (s, steps = WIZARD_STEPS) => steps[Math.min(stepIndex(s, steps) + 1, steps.length - 1)];
const prevStep = (s, steps = WIZARD_STEPS) => steps[Math.max(stepIndex(s, steps) - 1, 0)];
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
function resolveInitialStep(ctx, steps = WIZARD_STEPS) {
  for (const step of steps) {
    if (step === 'cover') continue;
    if (!canAdvance(step, ctx).ok) return step;
  }
  return steps[steps.length - 1];
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

// ── Try at Home: no cover, the bag grid is the first screen ──
const T = TRY_AT_HOME_STEPS;
assert.deepEqual(T, ['bags', 'datetime', 'details']);
assert.equal(stepIndex('bags', T), 0);
assert.equal(stepIndex('cover', T), -1, 'cover is not a Try at Home step');
assert.equal(nextStep('bags', T), 'datetime');
assert.equal(nextStep('datetime', T), 'details');
assert.equal(nextStep('details', T), 'details', 'must not run past the last step');
assert.equal(prevStep('bags', T), 'bags', 'must not run before the first step');
assert.equal(prevStep('datetime', T), 'bags', 'Back from the day and time returns to the pieces');
assert.equal(nextStep('cover', T), 'bags', 'an old draft saved on the cover moves on to the pieces');
assert.equal(resolveInitialStep({ hasDateTime: false, bagCount: 0, detailsValid: false }, T), 'bags');
assert.equal(resolveInitialStep({ hasDateTime: false, bagCount: 1, detailsValid: false }, T), 'datetime');
assert.equal(resolveInitialStep({ hasDateTime: true, bagCount: 1, detailsValid: true }, T), 'details');
assert.equal(resolveInitialStep({ hasDateTime: true, bagCount: 7, detailsValid: true }, T), 'bags');
// The four-step list is still the default (Private Viewing passes no list).
assert.equal(nextStep('cover'), 'bags');
assert.equal(prevStep('bags'), 'cover');

console.log('booking-wizard self-check: all assertions passed');
