// Self-check for the Shopify → Neon mirror's row mapping: orders (person, money, gift,
// items), returns and bookings.
// Run: node src/lib/warehouse/orders.test.mjs   (Node 23.6+ imports the .ts directly)
import assert from 'node:assert/strict';
import {
  bookingDate, bookingRow, buyerPhone, likelyGift, orderReturns, orderRow, paymentMethod, portalReturnId, rateOn, sameName, totalInr,
} from './shopify-map.ts';

const money = (amount, currencyCode) => ({ amount: String(amount), currencyCode });
const line = (title, variant, qty, price, cur, handle) => ({ node: {
  title, variantTitle: variant, quantity: qty, product: handle ? { handle } : null,
  originalUnitPriceSet: { presentmentMoney: money(price, cur) },
} });

// An India order as the custom checkout leaves it: completed draft, 'manual' gateway,
// method in tags, no billing address.
const india = {
  id: 'gid://shopify/Order/111', name: '1111108', createdAt: '2026-10-14T05:27:35Z', updatedAt: '2026-10-17T16:50:27Z',
  cancelledAt: null, test: false, tags: ['cashfree', 'wa-optin', 'web-otp'],
  note: 'Payment: Paid online via Cashfree.\nReturn requested: Colour not as shown (2026-10-18)',
  email: 'Mansi@Example.com', phone: '+919821149847', paymentGatewayNames: ['manual'], discountCodes: ['mirkash10'],
  displayFinancialStatus: 'PAID', displayFulfillmentStatus: 'FULFILLED',
  totalPriceSet: { shopMoney: money('18799.0', 'INR'), presentmentMoney: money('18799.0', 'INR') },
  customer: { displayName: 'Mansi Mehta', phone: '+919821149847', email: 'mansi@example.com' },
  billingAddress: null,
  shippingAddress: { name: 'Mansi Mehta', city: 'Mumbai', countryCodeV2: 'IN', phone: '+919821149847' },
  lineItems: { edges: [
    line('Braidey Shoulder Bag', 'Silver', 1, '8999.0', 'INR', 'braidey-shoulder-bag'),
    line('Gigi Mini Bag', 'Olive Green', 1, '9800.0', 'INR', 'gigi-mini-bag'),
  ] },
  returns: { edges: [] },
};

const noFx = () => null;
const r = orderRow('india', india, noFx);
assert.equal(r.order_id, 'gid://shopify/Order/111');
assert.equal(r.store, 'india');
assert.equal(r.person_id, '9821149847');            // last 10 phone digits, same as personIdFor
assert.equal(r.email, 'mansi@example.com');
assert.equal(r.currency, 'INR');
assert.equal(r.total, 18799);
assert.equal(r.total_inr, 18799);                   // INR: exact, no FX needed
assert.equal(r.shop_currency, 'INR');
assert.deepEqual(r.discount_codes, ['MIRKASH10']);  // upper-cased
assert.equal(r.payment_method, 'cashfree');         // from the tag, not 'manual'
assert.equal(r.billing_name, 'Mansi Mehta');        // customer name stands in for billing
assert.equal(r.shipping_city, 'Mumbai');
assert.equal(r.shipping_country, 'IN');
assert.equal(r.likely_gift, false);
assert.deepEqual(r.items, [
  { handle: 'braidey-shoulder-bag', title: 'Braidey Shoulder Bag', variant: 'Silver', quantity: 1, price: 8999 },
  { handle: 'gigi-mini-bag', title: 'Gigi Mini Bag', variant: 'Olive Green', quantity: 1, price: 9800 },
]);
assert.equal(r.financial_status, 'PAID');
assert.equal(r.fulfillment_status, 'FULFILLED');
assert.equal(r.cancelled_at, null);
assert.equal(r.is_test, false);
assert.equal(r.updated_at, india.updatedAt);

// A Global order paid in AED: total is what the customer paid; INR comes from the shop's
// USD total × that day's USD→INR rate.
const global = {
  ...india, id: 'gid://shopify/Order/222', name: '#1059108', createdAt: '2026-09-26T05:32:16Z', tags: [], note: null,
  email: 'buyer@example.com', phone: null, paymentGatewayNames: ['shopify_payments'], discountCodes: [],
  totalPriceSet: { shopMoney: money('314.39', 'USD'), presentmentMoney: money('1155.0', 'AED') },
  customer: { displayName: 'Suchitra Harihar', phone: null, email: 'buyer@example.com' },
  billingAddress: { name: 'Suchitra Harihar', city: 'Dubai', countryCodeV2: 'AE', phone: '00971559780946' },
  shippingAddress: { name: 'Suchitra Harihar', city: 'Dubai', countryCodeV2: 'AE', phone: '00971559780946' },
  lineItems: { edges: [line('GIGI — Olive', 'Olive', 1, '1005.0', 'AED', 'gigi-olive')] },
};
const fx = (c, d) => (c === 'USD' && d === '2026-09-26' ? 95.82 : null);
const g = orderRow('global', global, fx);
assert.equal(g.currency, 'AED');
assert.equal(g.total, 1155);
assert.equal(g.shop_currency, 'USD');
assert.equal(g.shop_total, 314.39);
assert.equal(g.total_inr, 30124.85);                 // 314.39 × 95.82
assert.equal(g.payment_method, 'shopify_payments');
assert.equal(g.person_id, '1559780946');             // billing phone, last 10 digits
assert.equal(orderRow('global', global, noFx).total_inr, null); // no rate → unknown, never a guess
assert.equal(totalInr({ createdAt: '2026-01-01T00:00:00Z', totalPriceSet: { shopMoney: money('10', 'USD'), presentmentMoney: money('830', 'INR') } }, noFx), 830);

// person_id falls back to email when no phone has 10 digits; nothing at all → null.
const hk = { ...global, billingAddress: { ...global.billingAddress, phone: '91218017' }, shippingAddress: { ...global.shippingAddress, phone: '91218017' } };
assert.equal(orderRow('global', hk, fx).person_id, 'e:buyer@example.com');
assert.equal(orderRow('global', { ...hk, email: null, customer: null }, fx).person_id, null);

// ── likely_gift ──
assert.equal(sameName('Priya', 'priya  SHARMA'), true);       // first name only still the buyer
assert.equal(sameName('Priya Sharma', 'Neha Sharma'), false);
assert.equal(sameName('', 'Neha'), null);
// "Yash Yash" (checkout autofill) vs customer "Yash Sakhlecha" → same person.
assert.equal(likelyGift({ customer: { displayName: 'Yash Sakhlecha' }, billingAddress: null, shippingAddress: { name: 'Yash Yash', city: 'Mumbai' } }), false);
// Shipped to a different name → gift.
assert.equal(likelyGift({ customer: { displayName: 'Mansi Mehta' }, billingAddress: null, shippingAddress: { name: 'Riya Kapoor', city: 'Mumbai' } }), true);
// Same name, different city from billing → gift (sent to family elsewhere).
assert.equal(likelyGift({ customer: null, billingAddress: { name: 'A Shah', city: 'Pune' }, shippingAddress: { name: 'A Shah', city: 'Delhi' } }), true);
assert.equal(likelyGift({ customer: null, billingAddress: { name: 'A Shah', city: 'New  Delhi' }, shippingAddress: { name: 'a shah', city: 'new delhi' } }), false);
assert.equal(likelyGift({ customer: null, billingAddress: { name: 'Tanya Jain', city: 'London' }, shippingAddress: { name: 'Tanya Jain', city: 'Wandsworth, London' } }), false);
// Nothing to compare / nothing shipped → unknown.
assert.equal(likelyGift({ customer: null, billingAddress: null, shippingAddress: { name: 'X Y', city: 'Mumbai' } }), null);
assert.equal(likelyGift({ customer: { displayName: 'X' }, billingAddress: null, shippingAddress: null }), null);

// On a gift the shipping phone is the RECIPIENT's: never used for the buyer's person_id.
const gift = { phone: null, customer: { phone: null }, billingAddress: null, shippingAddress: { phone: '+91 98200 00001' } };
assert.equal(buyerPhone(gift, true), null);
assert.equal(buyerPhone(gift, false), '+91 98200 00001');
const giftOrder = { ...india, phone: null, customer: { displayName: 'Mansi Mehta', phone: null, email: 'mansi@example.com' },
  shippingAddress: { name: 'Riya Kapoor', city: 'Delhi', countryCodeV2: 'IN', phone: '+919820000001' } };
const gr = orderRow('india', giftOrder, noFx);
assert.equal(gr.likely_gift, true);
assert.equal(gr.person_id, 'e:mansi@example.com');

assert.equal(paymentMethod({ tags: ['cod'], paymentGatewayNames: ['manual'] }), 'cod');
assert.equal(paymentMethod({ tags: [], paymentGatewayNames: ['PayPal', 'paypal'] }), 'paypal');
assert.equal(paymentMethod({ tags: [], paymentGatewayNames: [] }), null);

// ── Returns ──
const rets = orderReturns(india, r);
assert.equal(rets.length, 1);
assert.deepEqual(rets[0], {
  return_id: 'req:111:2026-10-18', order_id: india.id, person_id: '9821149847', created_at: '2026-10-18T00:00:00Z',
  reason: 'Colour not as shown', items: r.items, source: 'portal', status: 'requested',
});
assert.equal(portalReturnId('gid://shopify/Order/111', '2026-10-18'), 'req:111:2026-10-18'); // same id /api/returns writes
// A reason-less request, and a Return opened in Shopify.
const withShopifyReturn = { ...india, note: 'Return requested (2026-10-19)', returns: { edges: [{ node: {
  id: 'gid://shopify/Return/9', name: '1111108-R1', status: 'OPEN', createdAt: '2026-10-20T07:14:06Z',
  returnLineItems: { edges: [{ node: { quantity: 1, returnReason: 'SIZE_TOO_SMALL', returnReasonNote: '', customerNote: 'Too small for a laptop',
    fulfillmentLineItem: { lineItem: line('Gigi Mini Bag', 'Olive Green', 1, '9800.0', 'INR', 'gigi-mini-bag').node } } }] },
} }] } };
const [portal, shop] = orderReturns(withShopifyReturn, r);
assert.equal(portal.reason, null);
assert.equal(portal.return_id, 'req:111:2026-10-19');
assert.equal(shop.return_id, 'gid://shopify/Return/9');
assert.equal(shop.source, 'shopify');
assert.equal(shop.reason, 'size too small: Too small for a laptop');
assert.deepEqual(shop.items, [{ handle: 'gigi-mini-bag', title: 'Gigi Mini Bag', variant: 'Olive Green', quantity: 1, price: 9800 }]);

// ── Bookings ──
assert.equal(bookingDate('Fri, 23 Oct', '2026-10-21T06:08:09Z'), '2026-10-23');
assert.equal(bookingDate('Sat, 2 Jan', '2026-12-29T10:00:00Z'), '2027-01-02');   // booked in Dec for Jan
assert.equal(bookingDate('2026-11-05', '2026-10-21T06:08:09Z'), '2026-11-05');
assert.equal(bookingDate('soon', '2026-10-21T06:08:09Z'), null);

const tah = {
  id: 'gid://shopify/DraftOrder/1', createdAt: '2026-10-20T18:05:24Z', status: 'OPEN', tags: ['demo-confirmed', 'home-demo'],
  email: null, phone: '+918104142695',
  customAttributes: [
    { key: 'demo_date', value: 'Wed, 21 Oct' }, { key: 'demo_slot', value: 'Evening (5–8 PM)' },
    { key: 'demo_status', value: 'confirmed' }, { key: 'demo_confirmed_date', value: '2026-10-22' },
  ],
  shippingAddress: { city: 'Thane' },
  lineItems: { edges: [
    { node: { title: 'Gigi Mini Bag', product: { handle: 'gigi-mini-bag' } } },
    { node: { title: 'Gigi Mini Bag', product: { handle: 'gigi-mini-bag' } } },
    { node: { title: 'Old Bag', product: null } },
  ] },
};
assert.deepEqual(bookingRow(tah), {
  booking_id: tah.id, flow: 'try_at_home', person_id: '8104142695', created_at: tah.createdAt,
  date: '2026-10-22', slot: 'Evening (5–8 PM)', city: 'Thane', bags: ['gigi-mini-bag', 'Old Bag'], status: 'confirmed',
});
const pv = { ...tah, id: 'gid://shopify/DraftOrder/2', tags: ['private-viewing'], phone: '+447700900123', email: 'a@b.co',
  customAttributes: [{ key: 'viewing_date', value: '2026-11-02' }, { key: 'viewing_slot', value: '18:30' }, { key: 'viewing_city', value: 'London' }],
  shippingAddress: null, lineItems: { edges: [] } };
const pvr = bookingRow(pv);
assert.equal(pvr.flow, 'private_viewing');
assert.equal(pvr.date, '2026-11-02');
assert.equal(pvr.city, 'London');
assert.equal(pvr.status, 'requested');
assert.equal(pvr.person_id, '7700900123');
assert.equal(bookingRow({ ...tah, tags: ['web-otp'] }), null); // checkout drafts aren't bookings

// ── FX lookup ──
const series = { '2026-09-25': 95.82, '2026-09-28': 95.98 };
assert.equal(rateOn(series, '2026-09-27'), 95.82);  // weekend → Friday's rate
assert.equal(rateOn(series, '2026-09-28'), 95.98);
assert.equal(rateOn(series, '2026-09-01'), 95.82);  // before the series → earliest
assert.equal(rateOn({}, '2026-09-28'), null);

console.log('orders.test: all passed');
