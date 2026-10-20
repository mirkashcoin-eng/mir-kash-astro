// Self-check for the Try at Home PIN → city lookup.
// Run: node src/lib/cities.test.mjs
import assert from 'node:assert/strict';

// Mirrors cityForPin and MUMBAI_AREA_PINS in src/lib/cities.ts (kept inline, not
// imported, so this runs on plain Node without a TypeScript loader).
const MUMBAI_AREA_PINS = [
  [400001, 400104, 'Mumbai'],
  [400601, 400613, 'Thane'],
  [400614, 400614, 'Navi Mumbai'],
  [400615, 400615, 'Thane'],
  [400701, 400710, 'Navi Mumbai'],
  [410206, 410206, 'Panvel'],
  [410210, 410210, 'Navi Mumbai'],
  [401101, 401107, 'Mira-Bhayandar'],
  [401201, 401209, 'Vasai-Virar'],
  [401301, 401305, 'Vasai-Virar'],
  [421001, 421005, 'Ulhasnagar'],
  [421201, 421204, 'Dombivli'],
  [421301, 421301, 'Kalyan'],
  [421304, 421304, 'Kalyan'],
  [421306, 421306, 'Kalyan'],
  [421501, 421501, 'Ambernath'],
  [421503, 421503, 'Badlapur'],
  [421505, 421505, 'Ambernath'],
];
function cityForPin(pin) {
  if (!/^\d{6}$/.test(pin.trim())) return null;
  const n = Number(pin.trim());
  return MUMBAI_AREA_PINS.find(([lo, hi]) => n >= lo && n <= hi)?.[2] ?? null;
}

// ── Known Mumbai-area PINs fill the city ──
assert.equal(cityForPin('400001'), 'Mumbai', 'Fort');
assert.equal(cityForPin('400050'), 'Mumbai', 'Bandra West');
assert.equal(cityForPin('400104'), 'Mumbai', 'top of the Mumbai range');
assert.equal(cityForPin('400601'), 'Thane');
assert.equal(cityForPin('400614'), 'Navi Mumbai', 'CBD Belapur sits inside the Thane range');
assert.equal(cityForPin('400703'), 'Navi Mumbai', 'Vashi');
assert.equal(cityForPin('410210'), 'Navi Mumbai', 'Kharghar');
assert.equal(cityForPin('401107'), 'Mira-Bhayandar');
assert.equal(cityForPin('421201'), 'Dombivli');
assert.equal(cityForPin(' 400050 '), 'Mumbai', 'surrounding spaces are ignored');

// ── Anything else is left for the visitor (never refused here) ──
assert.equal(cityForPin('110001'), null, 'Delhi');
assert.equal(cityForPin('411001'), null, 'Pune is not in the service area');
assert.equal(cityForPin('400105'), null, 'just past the Mumbai range');
assert.equal(cityForPin('40005'), null, 'five digits is not a PIN');
assert.equal(cityForPin('4000501'), null, 'seven digits is not a PIN');
assert.equal(cityForPin('40005a'), null);
assert.equal(cityForPin(''), null);

// ── Every city the table fills in passes the Mumbai-area check ──
// Mirrors MUMBAI_AREA / isMumbaiArea's substring match in cities.ts.
const MUMBAI_AREA = ['mumbai', 'bombay', 'navi mumbai', 'thane', 'kalyan', 'dombivli', 'mira', 'bhayandar',
  'vasai', 'virar', 'ulhasnagar', 'panvel', 'badlapur', 'ambernath', 'ambarnath'];
for (const [, , city] of MUMBAI_AREA_PINS) {
  assert.ok(MUMBAI_AREA.some((m) => city.toLowerCase().includes(m)), `${city} must pass isMumbaiArea`);
}

console.log('cities self-check: all assertions passed');
