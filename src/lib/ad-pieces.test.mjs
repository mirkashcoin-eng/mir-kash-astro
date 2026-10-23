// Self-check for the Try at Home ad preselection rule.
// Run: node src/lib/ad-pieces.test.mjs
import assert from 'node:assert/strict';

// Mirrors src/lib/ad-pieces.ts (kept inline, not imported, so this runs on
// plain Node without a TypeScript loader).
const TAH_AD_PIECE = { bag: 'gigi-mini-bag', color: 'olive green' };
const TAH_CAMPAIGN = /try\s*-?\s*at\s*-?\s*home|\btah\b/i;
function adPreselect(q) {
  if (q.get('bag') || q.get('bags')) return null;
  if ((q.get('utm_source') ?? '').toLowerCase() !== 'meta') return null;
  if (!TAH_CAMPAIGN.test(q.get('utm_campaign') ?? '')) return null;
  return { ...TAH_AD_PIECE };
}

const p = (s) => adPreselect(new URLSearchParams(s));
const ad = 'utm_source=meta&utm_medium=paid&utm_campaign=Try%20at%20Home%20%C2%B7%20Mumbai%20%C2%B7%20Leads&utm_content=6994386000000';

// A click on a live Try at Home ad gets the piece the ad showed.
assert.deepEqual(p(ad), TAH_AD_PIECE);
assert.deepEqual(p('utm_source=Meta&utm_campaign=TAH%20test'), TAH_AD_PIECE);

// A link that names its own piece always wins.
assert.equal(p(ad + '&bag=foxy-rhinestone-clutch'), null);
assert.equal(p(ad + '&bags=tory-structured-bag,kelly-crystal-clutch'), null);

// Anything that isn't a Meta Try at Home ad is left alone.
assert.equal(p(''), null);
assert.equal(p('utm_source=meta&utm_campaign=Online%20%C2%B7%20India%20%C2%B7%20Tassel%20Charm%20%C2%B7%20Sales'), null);
assert.equal(p('utm_source=google&utm_campaign=Try%20at%20Home'), null);
assert.equal(p('fbclid=abc'), null);

console.log('ad-pieces: all checks passed');
