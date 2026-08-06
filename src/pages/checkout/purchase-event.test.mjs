import assert from 'node:assert/strict';
// Mirrors the purchase-conversion guard on /checkout/return.
function makePage() {
  const store = {}, sent = [];
  const gtag = (...a) => sent.push(a);
  const fire = ({ txnId, value, currency, isCod }) => {
    const seen = 'mk_purchase_' + txnId;
    if (!store[seen] && typeof gtag === 'function') {
      store[seen] = '1';
      const payload = { transaction_id: txnId, currency, market: 'india', country: 'IN' };
      if (!isCod && value > 0) payload.value = value;
      gtag('event', 'purchase', payload);

      const adsPayload = { send_to: 'AW-18098313640/0yRaCMK76NwcEKiz-bVD', transaction_id: txnId, currency };
      if (!isCod && value > 0) adsPayload.value = value;
      gtag('event', 'conversion', adsPayload);
    }
  };
  return { fire, sent };
}
// Each purchase fires exactly two events: GA4 purchase + Ads conversion.
let p = makePage();
const order = { txnId: '#1042', value: 4999, currency: 'INR', isCod: false };
p.fire(order);
assert.equal(p.sent.length, 2, 'one purchase fires GA4 + Ads, nothing more');
assert.deepEqual(p.sent[0][2], { transaction_id: '#1042', currency: 'INR', market: 'india', country: 'IN', value: 4999 });
assert.deepEqual(p.sent[1][2], { send_to: 'AW-18098313640/0yRaCMK76NwcEKiz-bVD', transaction_id: '#1042', currency: 'INR', value: 4999 });

// A refresh must not book the same sale twice, on either destination.
p.fire(order); p.fire(order);
assert.equal(p.sent.length, 2, 'refreshing must not double-count revenue');

// Distinct orders in one session must each convert (2 events apiece).
p = makePage();
p.fire({ txnId: '#1', value: 100, currency: 'INR', isCod: false });
p.fire({ txnId: '#2', value: 200, currency: 'INR', isCod: false });
assert.equal(p.sent.length, 4, 'different orders are separate conversions');

// COD has no Cashfree amount — send both events, omit value (never report a false 0).
p = makePage();
p.fire({ txnId: '#COD', value: 0, currency: 'INR', isCod: true });
assert.equal(p.sent.length, 2, 'COD still counts as a conversion on both destinations');
assert.equal('value' in p.sent[0][2], false, 'COD must not report a 0 value to GA4');
assert.equal('value' in p.sent[1][2], false, 'COD must not report a 0 value to Ads');

// A missing/zero amount on a gateway order also omits value rather than lying.
p = makePage();
p.fire({ txnId: '#0', value: 0, currency: 'INR', isCod: false });
assert.equal('value' in p.sent[0][2], false, 'zero amount omitted from GA4');
assert.equal('value' in p.sent[1][2], false, 'zero amount omitted from Ads');
console.log('purchase-conversion self-check: all assertions passed');
