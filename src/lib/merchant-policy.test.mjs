// Self-check for shipping zones, return offices and delivery dates (brand-wiki/SHIPPING-RETURNS-POLICY.md).
// Run: node src/lib/merchant-policy.test.mjs   (Node 23.6+ strips the TypeScript types itself)
import assert from 'node:assert/strict';
import { shippingFor, returnOfficeFor, returnDaysFor, deliveryBy, usesInches } from './merchant-policy.ts';

// Return window: India 7 days, every Global country 15
assert.equal(returnDaysFor('IN'), 7);
assert.equal(returnDaysFor('in'), 7);
assert.equal(returnDaysFor('US'), 15);
assert.equal(returnDaysFor('HK'), 15);

// Zones and rates
assert.deepEqual([shippingFor('IN').cost, shippingFor('IN').currency], [0, 'INR']);
assert.deepEqual([shippingFor('HK').cost, shippingFor('HK').zone], [0, 'Hong Kong']);
assert.equal(shippingFor('SG').cost, 20);
assert.equal(shippingFor('US').cost, 30);
assert.equal(shippingFor('gb').cost, 30);            // lower-case code, Europe set
assert.equal(shippingFor('DE').zone, 'UK & Europe');
assert.equal(shippingFor('AE').zone, 'Middle East');
assert.equal(shippingFor('BR').cost, 40);
assert.equal(shippingFor('XX').zone, 'Rest of world'); // unknown → rest of world
assert.ok(['US', 'GB', 'HK', 'SG', 'AE', 'BR'].every((c) => shippingFor(c).dutiesIncluded));

// Return offices: India → Mumbai, every Global country → Hong Kong
assert.equal(returnOfficeFor('IN').city, 'Mumbai');
assert.equal(returnOfficeFor('US').city, 'Hong Kong');
assert.equal(returnOfficeFor('MX').city, 'Hong Kong');
assert.equal(returnOfficeFor('GB').city, 'Hong Kong');
assert.equal(returnOfficeFor('HK').city, 'Hong Kong');

// Inches only for the US
assert.equal(usesInches('US'), true);
assert.equal(usesInches('GB'), false);

// Delivery date counts business days only: Friday 3 Oct 2025 + HK (3 + 2 = 5 business days) → Friday 10 Oct
const fri = new Date(2025, 9, 3);
const hk = deliveryBy(shippingFor('HK'), fri);
assert.equal(hk.getDay(), 5);
assert.equal(hk.getDate(), 10);
// India: 2 + 8 = 10 business days from Monday 6 Oct → Monday 20 Oct
const mon = new Date(2025, 9, 6);
assert.equal(deliveryBy(shippingFor('IN'), mon).getDate(), 20);

console.log('merchant-policy: all checks passed');
