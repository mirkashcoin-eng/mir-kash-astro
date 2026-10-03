// Self-check for the shared booking-draft store (Try at Home + Private Viewing).
// Run: node src/lib/booking-draft.test.mjs
import assert from 'node:assert/strict';

function fakeStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
  };
}
const throwingStorage = {
  getItem() { throw new Error('storage disabled'); },
  setItem() { throw new Error('storage disabled'); },
  removeItem() { throw new Error('storage disabled'); },
};

// Mirrors src/lib/booking-draft.ts
const VERSION = 1;
const mk = (storage) => ({
  save(key, draft) {
    try { storage.setItem(key, JSON.stringify({ v: VERSION, at: new Date().toISOString(), ...draft })); } catch {}
  },
  load(key) {
    try {
      const raw = storage.getItem(key);
      if (!raw) return null;
      const p = JSON.parse(raw);
      if (p?.v !== VERSION || typeof p.fields !== 'object' || !p.fields) return null;
      return {
        step: typeof p.step === 'string' ? p.step : 'cover',
        dateISO: typeof p.dateISO === 'string' ? p.dateISO : '',
        dateLabel: typeof p.dateLabel === 'string' ? p.dateLabel : '',
        slot: typeof p.slot === 'string' ? p.slot : '',
        bags: Array.isArray(p.bags) ? p.bags : [],
        fields: p.fields,
      };
    } catch { return null; }
  },
  clear(key) { try { storage.removeItem(key); } catch {} },
});

const TRY_AT_HOME = 'mk_tryhome_draft';
const PRIVATE_VIEWING = 'mk_privateviewing_draft';
const DRAFT = {
  step: 'bags',
  dateISO: '2026-11-02',
  dateLabel: 'Mon, 2 Nov',
  slot: 'Afternoon (2–5 PM)',
  bags: [{ variantId: 'gid://shopify/ProductVariant/1', title: 'Charlotte Bag — Brown' }],
  fields: { 'f-name': 'Priya Sharma', 'f-phone': '9876543210' },
};

// Round-trips what was typed.
{
  const d = mk(fakeStorage());
  d.save(TRY_AT_HOME, DRAFT);
  const back = d.load(TRY_AT_HOME);
  assert.deepEqual(back.bags, DRAFT.bags);
  assert.equal(back.slot, DRAFT.slot);
  assert.equal(back.step, 'bags');
}

// The two flows' keys never collide, even in the same storage.
{
  const storage = fakeStorage();
  const d = mk(storage);
  d.save(TRY_AT_HOME, DRAFT);
  d.save(PRIVATE_VIEWING, { ...DRAFT, step: 'details', slot: 'Evening (5–8 PM)' });
  assert.equal(d.load(TRY_AT_HOME).slot, DRAFT.slot);
  assert.equal(d.load(PRIVATE_VIEWING).slot, 'Evening (5–8 PM)');
  assert.notEqual(storage.getItem('mk_checkout_draft'), d.load(TRY_AT_HOME), 'must not touch the checkout draft key');
}

// Nothing saved, corrupt JSON, or an older shape → start clean, never half-restore.
{
  const s = fakeStorage(); const d = mk(s);
  assert.equal(d.load(TRY_AT_HOME), null, 'empty storage');
  s.setItem(TRY_AT_HOME, 'not json at all');
  assert.equal(d.load(TRY_AT_HOME), null, 'corrupt');
  s.setItem(TRY_AT_HOME, JSON.stringify({ v: 999, fields: DRAFT.fields }));
  assert.equal(d.load(TRY_AT_HOME), null, 'future version');
  s.setItem(TRY_AT_HOME, JSON.stringify({ v: 1 }));
  assert.equal(d.load(TRY_AT_HOME), null, 'no fields');
}

// Storage throwing must never surface — the wizard has to keep working.
{
  const d = mk(throwingStorage);
  assert.doesNotThrow(() => d.save(TRY_AT_HOME, DRAFT));
  assert.equal(d.load(TRY_AT_HOME), null);
  assert.doesNotThrow(() => d.clear(TRY_AT_HOME));
}

// clearDraft removes only its own key.
{
  const storage = fakeStorage();
  const d = mk(storage);
  d.save(TRY_AT_HOME, DRAFT);
  d.save(PRIVATE_VIEWING, DRAFT);
  d.clear(TRY_AT_HOME);
  assert.equal(d.load(TRY_AT_HOME), null, 'cleared draft must be gone');
  assert.notEqual(d.load(PRIVATE_VIEWING), null, 'the other flow’s draft must survive');
}

console.log('booking-draft self-check: all assertions passed');
