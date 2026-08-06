import assert from 'node:assert/strict';
// Mirrors the Shopify→person promotion in src/pages/api/admin/data.ts
function promote(p, a) {
  const d = a?.detail, addr = d?.address;
  const shopAddress = addr ? [addr.address1, addr.address2, addr.city, addr.province, addr.zip].filter(Boolean).join(', ') : null;
  const shopCart = d?.lines?.length ? {
    total: Number(d.total?.amount || a?.total?.amount || 0),
    currency: d.total?.currencyCode || 'INR',
    quantity: d.lines.reduce((n,l)=>n+l.quantity,0),
    lines: d.lines.map(l=>({title:l.title,variant:l.variant,quantity:l.quantity,price:Number(l.price?.amount||0)})),
  } : null;
  const cart = p.cart ?? shopCart;
  return { ...p,
    name: p.name || a?.customer || addr?.name || null,
    address: p.address || shopAddress,
    items: p.items.length ? p.items : (d?.lines ?? []).map(l=>l.title),
    cart, cartValue: p.cartValue || Number(cart?.total || 0),
    cartCurrency: p.cart ? p.cartCurrency : (cart?.currency ?? p.cartCurrency),
  };
}
// The exact case from the screenshot: legacy import + rich Shopify draft.
const legacy = { name:null, phone:'9232892129', email:null, items:[], cart:null, cartValue:0, cartCurrency:'INR', address:null };
const draft = { customer:'Jay Dalani', email:null, total:{amount:'15399',currencyCode:'INR'},
  detail:{ address:{name:'Jay Dalani', address1:'13B, Winston Mansion', city:'Mumbai', province:'Maharashtra', zip:'400072'},
    lines:[{title:'Weaver Tote — Cherry Red', variant:'Cherry Red', quantity:1, price:{amount:'15399'}}],
    total:{amount:'15399',currencyCode:'INR'} } };
const r = promote(legacy, draft);
assert.equal(r.name, 'Jay Dalani', 'name promoted from the draft');
assert.equal(r.cartValue, 15399, 'value promoted');
assert.equal(r.cart.lines[0].title, 'Weaver Tote — Cherry Red', 'bag promoted');
assert.match(r.address, /Winston Mansion.*Mumbai/, 'address promoted');
assert.deepEqual(r.items, ['Weaver Tote — Cherry Red']);

// Our own richer data must win over Shopify's.
const ours = { name:'Real Name', phone:'9', email:null, items:['Our Bag'], cart:{total:999,currency:'INR',quantity:1,lines:[]}, cartValue:999, cartCurrency:'INR', address:'Our Addr' };
const k = promote(ours, draft);
assert.equal(k.name, 'Real Name', 'own name wins');
assert.equal(k.cartValue, 999, 'own cart value wins');
assert.equal(k.address, 'Our Addr', 'own address wins');

// No Shopify match → unchanged, no crash.
const bare = promote({ name:null, phone:'9', email:null, items:[], cart:null, cartValue:0, cartCurrency:'INR', address:null }, null);
assert.equal(bare.name, null); assert.equal(bare.cart, null); assert.equal(bare.cartValue, 0);
console.log('promotion self-check: all assertions passed');
