// Self-check for India coupon handling: the cart money derivation that decides what
// Cashfree gets charged, and the identity normalization the redemption ledger keys on.
// Run: node src/lib/coupons.test.mjs
import assert from 'node:assert/strict';

// ── Cart money (mirrors normalize() in shopify/cart.ts) ──────────────────────
const r2 = (n) => Math.round(n * 100) / 100;

function normalizeMoney(cart) {
  const lines = cart.lines.map((l) => ({
    price: Number(l.price),
    quantity: l.quantity,
    lineTotal: r2(Number(l.price) * l.quantity),
  }));
  const subtotal = r2(lines.reduce((s, l) => s + l.lineTotal, 0));
  const total = Number(cart.totalAmount);
  return { subtotal, total, discountAmount: r2(Math.max(0, subtotal - total)), lines };
}

// What Shopify prices the draft order at: bare variantId+quantity, free shipping,
// minus the FIXED_AMOUNT discount we attach. This is the amount Cashfree charges.
const draftTotal = (cart) => {
  const m = normalizeMoney(cart);
  return r2(m.lines.reduce((s, l) => s + l.lineTotal, 0) - m.discountAmount);
};

const twoLines = { lines: [{ price: '1500.00', quantity: 2 }, { price: '700.00', quantity: 1 }] };
// gross = 3700

// The bug: a PRODUCT-scoped code allocates at the line level, so Shopify's
// cost.subtotalAmount is ALREADY net of it. Deriving the discount from
// subtotalAmount − totalAmount gave 0 and the coupon never reached the draft.
{
  const productDiscount = { ...twoLines, totalAmount: '3200.00', shopifySubtotalAmount: '3200.00' };
  const m = normalizeMoney(productDiscount);
  assert.equal(m.subtotal, 3700, 'subtotal must stay GROSS, not Shopify cost.subtotalAmount');
  assert.equal(m.discountAmount, 500, 'line-allocated discount must be detected');
  // The old derivation, kept here as the regression it is:
  const old = Math.max(0, Number(productDiscount.shopifySubtotalAmount) - Number(productDiscount.totalAmount));
  assert.equal(old, 0, 'old formula returned 0 — this is what caused the overcharge');
  assert.equal(draftTotal(productDiscount), 3200, 'Cashfree must be charged the displayed total');
}

// An ORDER-level code worked before the fix and must keep working.
{
  const orderDiscount = { ...twoLines, totalAmount: '3200.00' };
  assert.equal(draftTotal(orderDiscount), 3200, 'order-level discount regression');
}

// No discount at all: nothing is attached, full price charged.
{
  const plain = { ...twoLines, totalAmount: '3700.00' };
  const m = normalizeMoney(plain);
  assert.equal(m.discountAmount, 0);
  assert.equal(draftTotal(plain), 3700);
}

// Free shipping on an already-free-shipping checkout: valid code, ₹0 off.
// The row hides but the code must stay applied (see the handler in CheckoutPage).
{
  const freeship = { ...twoLines, totalAmount: '3700.00' };
  assert.equal(normalizeMoney(freeship).discountAmount, 0);
}

// The invariant the whole fix rests on: charged === displayed, for any total.
for (const t of ['3700.00', '3200.00', '3699.99', '0.01', '1233.33']) {
  const cart = { ...twoLines, totalAmount: t };
  assert.equal(draftTotal(cart), Number(t), `draft total must equal cart total for ${t}`);
}

// Percentage codes produce thirds; rounding must not drift past the ₹1 log threshold.
{
  const odd = { lines: [{ price: '999.99', quantity: 3 }], totalAmount: '2699.97' };
  const m = normalizeMoney(odd);
  assert.equal(m.subtotal, 2999.97, 'price × qty must round to paise');
  assert.equal(m.discountAmount, 300);
  assert.ok(Math.abs(draftTotal(odd) - 2699.97) < 0.01, 'no float drift');
}

// Summary arithmetic: Subtotal − Discount === Total must hold on screen, or the
// buyer sees rows that don't add up.
for (const t of ['3700.00', '3200.00', '2500.50']) {
  const m = normalizeMoney({ ...twoLines, totalAmount: t });
  assert.equal(r2(m.subtotal - m.discountAmount), Number(t), 'summary rows must add up');
}

// ── Ledger identity (mirrors coupons.ts) ────────────────────────────────────
const normCode = (c) => c.trim().toUpperCase();
const normEmail = (e) => (e ? e.trim().toLowerCase() || null : null);
const normPhone = (p) => {
  if (!p) return null;
  const d = p.replace(/\D/g, '');
  return d.length >= 10 ? d.slice(-10) : d || null;
};

// A code is one code however it was typed, or the cap never fills.
for (const v of ['diwali20', ' Diwali20 ', 'DIWALI20']) assert.equal(normCode(v), 'DIWALI20');
for (const v of ['A@X.com', ' a@x.COM ']) assert.equal(normEmail(v), 'a@x.com');
// Same buyer whether the phone carries +91, spaces, or neither.
for (const v of ['+91 98765 43210', '9876543210', '+919876543210', '09876543210']) {
  assert.equal(normPhone(v), '9876543210');
}
assert.equal(normEmail(''), null);
assert.equal(normPhone(''), null);
assert.equal(normPhone(null), null);

// Doc id is what makes recording idempotent across return page / webhook / reconciler.
const docId = (code, orderName) => `${normCode(code)}:${orderName}`;
assert.equal(docId('diwali20', '#1001'), 'DIWALI20:#1001');
assert.equal(docId('DIWALI20', '#1001'), docId(' diwali20 ', '#1001'), 'same order → same doc');
assert.notEqual(docId('DIWALI20', '#1001'), docId('DIWALI20', '#1002'), 'different orders → different docs');

// ── The usage gate (mirrors couponLimitBlock) ───────────────────────────────
const blocked = (rules, ledgerCount, hasRedeemed, hasBuyer) => {
  if (!rules) return null;
  if (rules.usageLimit != null && rules.asyncUsageCount + ledgerCount >= rules.usageLimit) return 'exhausted';
  if (rules.appliesOncePerCustomer && hasBuyer && hasRedeemed) return 'already-used';
  return null;
};
const capped = { usageLimit: 2, appliesOncePerCustomer: false, asyncUsageCount: 0 };
assert.equal(blocked(capped, 0, false, true), null, '0 of 2 → allowed');
assert.equal(blocked(capped, 1, false, true), null, '1 of 2 → allowed');
assert.equal(blocked(capped, 2, false, true), 'exhausted', '2 of 2 → blocked');
// Shopify's own count (hosted checkout / manual drafts) adds to ours.
assert.equal(blocked({ ...capped, asyncUsageCount: 1 }, 1, false, true), 'exhausted');
// Uncapped codes are never exhausted, however many redemptions we've logged.
assert.equal(blocked({ usageLimit: null, appliesOncePerCustomer: false, asyncUsageCount: 0 }, 99, false, true), null);
// Per-customer needs a buyer — apply-discount has none, so it can't check this.
const perCustomer = { usageLimit: null, appliesOncePerCustomer: true, asyncUsageCount: 0 };
assert.equal(blocked(perCustomer, 0, true, false), null, 'no buyer known → cannot check');
assert.equal(blocked(perCustomer, 0, true, true), 'already-used', 'repeat buyer → blocked');
assert.equal(blocked(perCustomer, 0, false, true), null, 'new buyer → allowed');
// Automatic discounts have no code node; nothing to enforce.
assert.equal(blocked(null, 99, true, true), null);

// Firestore unavailable → counts read as 0 / false, so coupons still work.
assert.equal(blocked(capped, 0, false, true), null, 'outage must not block sales');

console.log('coupons self-check: all assertions passed');
