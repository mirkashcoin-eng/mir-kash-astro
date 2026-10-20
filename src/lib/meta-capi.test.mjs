// Self-check for Meta Conversions API user_data normalisation + hashing.
// Run: node src/lib/meta-capi.test.mjs
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { buildUserData } from './meta-capi.ts';

const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');

// Normalises before hashing, per Meta's customer-information spec.
{
  const u = buildUserData({
    email: '  Priya@Example.COM ',
    phone: '+91 98200-12345',
    firstName: ' Priya ',
    lastName: 'Shah',
    city: 'Navi Mumbai',
    zip: '400 703',
    country: 'IN',
    externalId: '+919820012345',
  });
  assert.deepEqual(u.em, [sha('priya@example.com')]);
  assert.deepEqual(u.ph, [sha('919820012345')]);
  assert.deepEqual(u.fn, [sha('priya')]);
  assert.deepEqual(u.ln, [sha('shah')]);
  assert.deepEqual(u.ct, [sha('navimumbai')]);
  assert.deepEqual(u.zp, [sha('400703')]);
  assert.deepEqual(u.country, [sha('in')]);
  assert.deepEqual(u.external_id, [sha('+919820012345')]);
}

// Browser identifiers pass through unhashed, exactly as Meta expects.
{
  const u = buildUserData({ ip: '1.2.3.4', userAgent: 'UA', fbp: 'fb.1.1.2', fbc: 'fb.1.1.abc' });
  assert.deepEqual(u, { client_ip_address: '1.2.3.4', client_user_agent: 'UA', fbp: 'fb.1.1.2', fbc: 'fb.1.1.abc' });
}

// Empty or invalid values are dropped rather than sent as hashes of nothing.
{
  const u = buildUserData({ email: '   ', phone: '---', city: '  ', zip: '', country: 'India', firstName: null });
  assert.deepEqual(u, {});
}

console.log('meta-capi: all checks passed');
