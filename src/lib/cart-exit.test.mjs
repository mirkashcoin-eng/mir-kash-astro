// Self-check for the cart "Before you go" panel helpers.
// Run: node src/lib/cart-exit.test.mjs
import assert from 'node:assert/strict';
import { MAX_BAGS, parseBags } from './cart-exit.ts';

// parseBags: clean, de-duplicated, capped, legacy ?bag= included, junk dropped.
assert.deepEqual(parseBags('gigi-mini-bag, Tory-Structured-Bag ,gigi-mini-bag'), ['gigi-mini-bag', 'tory-structured-bag']);
assert.deepEqual(parseBags(null, 'kelly-crystal-clutch'), ['kelly-crystal-clutch']);
assert.deepEqual(parseBags('a,b', 'b'), ['a', 'b']);
assert.deepEqual(parseBags('"><script>,../x,ok-bag'), ['ok-bag']);
assert.equal(parseBags('a,b,c,d,e,f,g,h').length, MAX_BAGS);
assert.deepEqual(parseBags('', ''), []);

console.log('cart-exit: all checks passed');
