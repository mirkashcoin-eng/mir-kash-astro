// Self-check for the checkout draft store and the payment-retry guard.
// Run: node src/lib/checkout-draft.test.mjs
import assert from 'node:assert/strict';

// ── A minimal localStorage, plus one that throws (Safari Private / in-app webviews) ──
function fakeStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    _size: () => m.size,
  };
}
const throwingStorage = {
  getItem() { throw new Error('storage disabled'); },
  setItem() { throw new Error('storage disabled'); },
  removeItem() { throw new Error('storage disabled'); },
};

// Mirrors src/lib/checkout-draft.ts
const KEY = 'mk_checkout_draft';
const VERSION = 1;
const mk = (storage) => ({
  save(draft) {
    try { storage.setItem(KEY, JSON.stringify({ v: VERSION, at: new Date().toISOString(), ...draft })); } catch {}
  },
  load() {
    try {
      const raw = storage.getItem(KEY);
      if (!raw) return null;
      const p = JSON.parse(raw);
      if (p?.v !== VERSION || typeof p.fields !== 'object' || !p.fields) return null;
      return { fields: p.fields, waOptin: p.waOptin !== false, pay: typeof p.pay === 'string' ? p.pay : '' };
    } catch { return null; }
  },
  clear() { try { storage.removeItem(KEY); } catch {} },
});

const FIELDS = { 'f-name': 'Priya Sharma', 'f-phone': '9876543210', 'f-addr': '12 Carter Road', 'f-city': 'Mumbai', 'f-state': 'Maharashtra', 'f-pin': '400050', 'f-email': 'priya@example.com' };

// Round-trips what the buyer typed.
{
  const d = mk(fakeStorage());
  d.save({ fields: FIELDS, waOptin: true, pay: 'card' });
  const back = d.load();
  assert.deepEqual(back.fields, FIELDS);
  assert.equal(back.pay, 'card');
  assert.equal(back.waOptin, true);
}

// waOptin is checked by default, so only an explicit false may turn it off —
// a missing value must not silently opt someone out of order updates.
{
  const d = mk(fakeStorage());
  d.save({ fields: FIELDS, waOptin: false, pay: '' });
  assert.equal(d.load().waOptin, false);
  d.save({ fields: FIELDS, waOptin: true, pay: '' });
  assert.equal(d.load().waOptin, true);
}

// Nothing saved, corrupt JSON, or a draft from an older shape → start clean rather
// than half-restore. One retyped address beats a stale value on a live order.
{
  const s = fakeStorage(); const d = mk(s);
  assert.equal(d.load(), null, 'empty storage');
  s.setItem(KEY, 'not json at all');
  assert.equal(d.load(), null, 'corrupt');
  s.setItem(KEY, JSON.stringify({ v: 999, fields: FIELDS }));
  assert.equal(d.load(), null, 'future version');
  s.setItem(KEY, JSON.stringify({ v: 1 }));
  assert.equal(d.load(), null, 'no fields');
}

// Storage throwing must never surface — checkout has to keep working.
{
  const d = mk(throwingStorage);
  assert.doesNotThrow(() => d.save({ fields: FIELDS, waOptin: true, pay: 'upi' }));
  assert.equal(d.load(), null);
  assert.doesNotThrow(() => d.clear());
}

// Survives an order being placed — the next order arrives pre-filled.
{
  const d = mk(fakeStorage());
  d.save({ fields: FIELDS, waOptin: true, pay: 'upi' });
  assert.notEqual(d.load(), null, 'draft must outlive a completed order');
}

// ── Step skipping (mirrors advanceFromFilledFields in CheckoutPage) ──
const emailRe = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
function advance(f) {
  const phoneOk = String(f['f-phone'] || '').replace(/\D/g, '').slice(-10).length === 10;
  const emailOk = emailRe.test(f['f-email'] || '');
  const deliveryOk = !!(f['f-name'] && f['f-addr'] && f['f-state'] && /^\d{6}$/.test(f['f-pin'] || '') && emailOk);
  if (phoneOk && deliveryOk) return 'payment';
  if (phoneOk) return 'delivery';
  return 'contact';
}
assert.equal(advance(FIELDS), 'payment', 'a complete draft opens at payment, not step 1');
assert.equal(advance({ 'f-phone': '9876543210' }), 'delivery');
assert.equal(advance({}), 'contact');
// Never skip a step the Continue button itself would reject.
assert.equal(advance({ ...FIELDS, 'f-pin': '40005' }), 'delivery', 'short PIN must not skip delivery');
assert.equal(advance({ ...FIELDS, 'f-email': 'not-an-email' }), 'delivery', 'bad email must not skip delivery');
assert.equal(advance({ ...FIELDS, 'f-phone': '98765' }), 'contact', 'short phone must not skip contact');

// ── Pre-fill precedence: typed > restored draft > profile ──
const setVal = (el, value) => { if (el && value && !el.value) el.value = value; };
{
  const typed = { value: '9999999999' };
  setVal(typed, '8888888888');
  assert.equal(typed.value, '9999999999', 'profile must never overwrite what is already there');
  const empty = { value: '' };
  setVal(empty, '8888888888');
  assert.equal(empty.value, '8888888888', 'but it must fill a gap');
  const blank = { value: '' };
  setVal(blank, null);
  assert.equal(blank.value, '', 'an absent profile value writes nothing');
}

// ── The double-payment guard (mirrors recoverAfterGatewayReturn) ──
// Only 'cancelled' may re-enable the pay button. Anything else — including every
// failure to find out — must leave it disabled, because guessing wrong charges twice.
const mayRetry = (state) => state === 'cancelled';
assert.equal(mayRetry('cancelled'), true);
assert.equal(mayRetry('paid'), false, 'already paid → must NOT be able to pay again');
assert.equal(mayRetry('pending'), false, 'payment still confirming → must not pay again');
assert.equal(mayRetry('unknown'), false, 'lookup failed → fail closed');
for (const junk of ['', null, undefined, 'PAID', 'something-new']) {
  assert.equal(mayRetry(junk), false, `unrecognised state ${JSON.stringify(junk)} must fail closed`);
}

// ── Server-side status mapping (mirrors api/checkout/status.ts + isAbandoned) ──
function stateFor(order, attempts) {
  if (!order) return 'unknown';                       // Cashfree unreachable
  if (order.orderStatus === 'PAID') return 'paid';
  if (order.orderStatus !== 'ACTIVE') return 'cancelled'; // EXPIRED / TERMINATED
  if (attempts === null) return 'cancelled';          // couldn't ask → offer a retry
  return attempts.some((a) => a.status === 'PENDING' || a.status === 'SUCCESS') ? 'pending' : 'cancelled';
}
assert.equal(stateFor(null, null), 'unknown');
assert.equal(stateFor({ orderStatus: 'PAID' }, []), 'paid');
assert.equal(stateFor({ orderStatus: 'EXPIRED' }, null), 'cancelled');
assert.equal(stateFor({ orderStatus: 'ACTIVE' }, []), 'cancelled', 'no attempt = they walked away');
assert.equal(stateFor({ orderStatus: 'ACTIVE' }, [{ status: 'PENDING' }]), 'pending', 'UPI awaiting approval');
assert.equal(stateFor({ orderStatus: 'ACTIVE' }, [{ status: 'SUCCESS' }]), 'pending', 'paid but order not settled yet');
assert.equal(stateFor({ orderStatus: 'ACTIVE' }, [{ status: 'FAILED' }]), 'cancelled', 'failed attempt → let them retry');
assert.equal(stateFor({ orderStatus: 'ACTIVE' }, [{ status: 'USER_DROPPED' }]), 'cancelled');
// A SUCCESS attempt must never be treated as retryable, whatever else is alongside it.
assert.equal(stateFor({ orderStatus: 'ACTIVE' }, [{ status: 'FAILED' }, { status: 'SUCCESS' }]), 'pending');

console.log('checkout-draft self-check: all assertions passed');
