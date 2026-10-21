// Self-check for the WhatsApp inbox helpers (webhook parsing, signature, templates,
// the 24h window, ticks, previews).
// Run: node src/lib/whatsapp-inbox.test.mjs   (Node 23.6+ imports the .ts directly)
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  WINDOW_MS, TEMPLATE_TEXT, parseWebhook, verifySignature, templateParams, renderTemplate,
  windowOpen, windowClosesAt, tickFor, previewOf,
} from './whatsapp-inbox.ts';

// 21 Oct 2026, 15:00 IST
const NOW = Date.parse('2026-10-21T09:30:00Z');
const TS = String(Math.floor(NOW / 1000)); // Meta's unix-seconds timestamp
const ISO = new Date(Number(TS) * 1000).toISOString();

// ── TEMPLATE_TEXT matches its sources word for word ─────────────────────────────
const md = readFileSync(new URL('../../whatsapp/templates/TEMPLATES.md', import.meta.url), 'utf8');
// The four the Supabase service sends that are filed by wa-setup.ts (order_shipped_v2 is
// TEMPLATES.md's order_shipped, which has the tracking link).
const fromMd = { cod_confirmation: 'cod_confirmation', order_shipped_v2: 'order_shipped', order_cancelled: 'order_cancelled', refund_processed: 'refund_processed' };
for (const [name, heading] of Object.entries(fromMd)) {
  const m = md.match(new RegExp('`' + heading + '`[^\\n]*\\n```\\n([\\s\\S]*?)\\n```'));
  assert.ok(m, `${heading} block in TEMPLATES.md`);
  assert.equal(TEMPLATE_TEXT[name], m[1], name);
}
// Every template wa-setup.ts files must read the same in the inbox as it was filed.
const setupFile = readFileSync(new URL('../pages/api/admin/wa-setup.ts', import.meta.url), 'utf8');
const setup = setupFile.slice(0, setupFile.indexOf('export const GET')); // just the TEMPLATES list
const filed = [...setup.matchAll(/name: '(\w+)'[\s\S]*?text:\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/g)];
assert.deepEqual(filed.map((f) => f[1]).sort(),
  ['cart_reminder', 'cod_confirmation', 'order_cancelled', 'order_confirmed', 'order_shipped', 'order_shipped_v2', 'refund_processed']);
for (const [, name, lit] of filed) assert.equal(TEMPLATE_TEXT[name], new Function('return ' + lit)(), name);
assert.equal(TEMPLATE_TEXT.hello_world, 'Hello World');
assert.equal(Object.keys(TEMPLATE_TEXT).length, 8);

// ── parseWebhook: a realistic multi-entry payload ───────────────────────────────
const payload = {
  object: 'whatsapp_business_account',
  entry: [
    {
      id: 'WABA1',
      changes: [{
        field: 'messages',
        value: {
          messaging_product: 'whatsapp',
          metadata: { display_phone_number: '15550001111', phone_number_id: 'PN1' },
          contacts: [{ profile: { name: 'Priya Shah' }, wa_id: '919876543210' }],
          messages: [
            { from: '919876543210', id: 'wamid.T1', timestamp: TS, type: 'text', text: { body: 'Is it in stock?' },
              context: { from: '15550001111', id: 'wamid.OUT1' } },
            { from: '919876543210', id: 'wamid.I1', timestamp: TS, type: 'image',
              image: { caption: 'This one', mime_type: 'image/jpeg', sha256: 'x', id: 'MEDIA1' } },
            { from: '919876543210', id: 'wamid.B1', timestamp: TS, type: 'button',
              button: { payload: 'YES', text: 'YES' }, context: { id: 'wamid.OUT2' } },
            { from: '919876543210', id: 'wamid.L1', timestamp: TS, type: 'interactive',
              interactive: { type: 'list_reply', list_reply: { id: 'r1', title: 'Track order' } } },
            { from: '919876543210', id: 'wamid.R1', timestamp: TS, type: 'reaction',
              reaction: { message_id: 'wamid.OUT1', emoji: '❤️' } },
            { from: '919876543210', id: 'wamid.U1', timestamp: TS, type: 'ephemeral', errors: [{ code: 131051 }] },
            'not an object',
            { from: '919876543210', timestamp: TS, type: 'text', text: { body: 'no id → skipped' } },
          ],
        },
      }],
    },
    {
      id: 'WABA1',
      changes: [
        { field: 'account_update', value: { messages: [{ id: 'x', from: '1', timestamp: TS, type: 'text' }] } },
        {
          field: 'messages',
          value: {
            metadata: { phone_number_id: 'PN2' },
            contacts: [{ wa_id: '+91 99999 00000' }],
            messages: [
              { from: '+91 99999-00000', id: 'wamid.D1', timestamp: TS, type: 'document',
                document: { filename: 'invoice.pdf', mime_type: 'application/pdf', id: 'MEDIA2' } },
              { from: '919999900000', id: 'wamid.V1', timestamp: TS, type: 'voice',
                voice: { mime_type: 'audio/ogg; codecs=opus', id: 'MEDIA3' } },
              { from: '919999900000', id: 'wamid.G1', timestamp: TS, type: 'location',
                location: { latitude: 34.08, longitude: 74.79 } },
              { from: '919999900000', id: 'wamid.G2', timestamp: TS, type: 'location',
                location: { latitude: 34.08, longitude: 74.79, name: 'Lal Chowk', address: 'Srinagar' } },
              { from: '919999900000', id: 'wamid.Q1', timestamp: TS, type: 'interactive',
                interactive: { type: 'button_reply', button_reply: { id: 'b1', title: 'Talk to us' } } },
            ],
            statuses: [
              { id: 'wamid.OUT1', status: 'delivered', timestamp: TS, recipient_id: '919876543210' },
              { id: 'wamid.OUT2', status: 'read', timestamp: TS, recipient_id: '919876543210' },
              { id: 'wamid.OUT3', status: 'failed', timestamp: TS, recipient_id: '919999900000',
                errors: [{ code: 131026, title: 'Message undeliverable', message: 'Message undeliverable',
                  error_data: { details: 'Recipient is not a WhatsApp user' } }] },
              { id: 'wamid.OUT4', status: 'failed', timestamp: TS, recipient_id: '919999900000',
                errors: [{ code: 1, title: 'Only a title' }] },
              { id: 'wamid.OUT5', status: 'deleted', timestamp: TS, recipient_id: '919999900000' },
              { id: 'wamid.OUT6', status: 'sent', timestamp: 'soon', recipient_id: '919999900000' },
            ],
          },
        },
      ],
    },
  ],
};
const parsed = parseWebhook(payload);
const byId = Object.fromEntries(parsed.inbound.map((r) => [r.meta_message_id, r]));
assert.deepEqual(parsed.inbound.map((r) => r.meta_message_id),
  ['wamid.T1', 'wamid.I1', 'wamid.B1', 'wamid.L1', 'wamid.R1', 'wamid.U1', 'wamid.D1', 'wamid.V1', 'wamid.G1', 'wamid.G2', 'wamid.Q1']);

assert.deepEqual({ ...byId['wamid.T1'], raw: undefined }, {
  meta_message_id: 'wamid.T1', from_phone: '919876543210', phone_number_id: 'PN1', kind: 'text',
  body: 'Is it in stock?', media_id: null, media_mime: null, reply_to: 'wamid.OUT1', received_at: ISO, raw: undefined,
});
assert.equal(byId['wamid.T1'].raw, payload.entry[0].changes[0].value.messages[0]);
assert.equal(byId['wamid.T1'].received_at, '2026-10-21T09:30:00.000Z');
assert.deepEqual([byId['wamid.I1'].kind, byId['wamid.I1'].body, byId['wamid.I1'].media_id, byId['wamid.I1'].media_mime],
  ['image', 'This one', 'MEDIA1', 'image/jpeg']);
assert.deepEqual([byId['wamid.B1'].kind, byId['wamid.B1'].body, byId['wamid.B1'].reply_to], ['button', 'YES', 'wamid.OUT2']);
assert.deepEqual([byId['wamid.L1'].kind, byId['wamid.L1'].body, byId['wamid.L1'].reply_to], ['button', 'Track order', null]);
assert.deepEqual([byId['wamid.Q1'].kind, byId['wamid.Q1'].body], ['button', 'Talk to us']);
assert.deepEqual([byId['wamid.R1'].kind, byId['wamid.R1'].body], ['reaction', '❤️']);
assert.deepEqual([byId['wamid.U1'].kind, byId['wamid.U1'].body, byId['wamid.U1'].media_id], ['unsupported', null, null]);
assert.deepEqual([byId['wamid.D1'].kind, byId['wamid.D1'].body, byId['wamid.D1'].media_id, byId['wamid.D1'].from_phone,
  byId['wamid.D1'].phone_number_id], ['document', 'invoice.pdf', 'MEDIA2', '919999900000', 'PN2']);
assert.deepEqual([byId['wamid.V1'].kind, byId['wamid.V1'].body, byId['wamid.V1'].media_id, byId['wamid.V1'].media_mime],
  ['audio', null, 'MEDIA3', 'audio/ogg; codecs=opus']);
assert.equal(byId['wamid.G1'].body, '34.08,74.79');
assert.equal(byId['wamid.G2'].body, 'Lal Chowk');

assert.deepEqual(parsed.contacts, [
  { phone: '919876543210', profile_name: 'Priya Shah' },
  { phone: '919999900000', profile_name: null },
]);
assert.deepEqual(parsed.statuses, [
  { meta_message_id: 'wamid.OUT1', recipient_phone: '919876543210', phone_number_id: 'PN2', status: 'delivered', at: ISO, error: null },
  { meta_message_id: 'wamid.OUT2', recipient_phone: '919876543210', phone_number_id: 'PN2', status: 'read', at: ISO, error: null },
  { meta_message_id: 'wamid.OUT3', recipient_phone: '919999900000', phone_number_id: 'PN2', status: 'failed', at: ISO,
    error: 'Recipient is not a WhatsApp user' },
  { meta_message_id: 'wamid.OUT4', recipient_phone: '919999900000', phone_number_id: 'PN2', status: 'failed', at: ISO,
    error: 'Only a title' },
]);

// Malformed bodies give empty lists and never throw.
const empty = { inbound: [], statuses: [], contacts: [] };
for (const bad of [null, undefined, {}, { entry: 'x' }, { entry: [null, 1, { changes: 'x' }] },
  { entry: [{ changes: [{ field: 'messages' }, { field: 'messages', value: { messages: 'x', statuses: {}, contacts: 3 } }] }] },
  'string', 42, []]) {
  assert.deepEqual(parseWebhook(bad), empty, JSON.stringify(bad));
}

// ── verifySignature ─────────────────────────────────────────────────────────────
const SECRET = 'test-app-secret';
const raw = JSON.stringify(payload);
const good = 'sha256=' + createHmac('sha256', SECRET).update(raw, 'utf8').digest('hex');
assert.equal(await verifySignature(raw, good, SECRET), true);
assert.equal(await verifySignature(raw, good.toUpperCase().replace('SHA256=', 'sha256='), SECRET), true);
assert.equal(await verifySignature(raw + ' ', good, SECRET), false);
assert.equal(await verifySignature(raw, good, 'wrong-secret'), false);
assert.equal(await verifySignature(raw, good.slice(7), SECRET), false);   // no "sha256=" prefix
assert.equal(await verifySignature(raw, good.slice(0, -2), SECRET), false); // length differs
assert.equal(await verifySignature(raw, null, SECRET), false);
assert.equal(await verifySignature(raw, '', SECRET), false);
assert.equal(await verifySignature(raw, good, ''), false);
// Non-ASCII bodies are signed as UTF-8.
const uni = '{"text":"₹4,990 — ❤️"}';
assert.equal(await verifySignature(uni, 'sha256=' + createHmac('sha256', SECRET).update(uni, 'utf8').digest('hex'), SECRET), true);

// ── templateParams + renderTemplate ─────────────────────────────────────────────
const req = (name, params) => ({
  messaging_product: 'whatsapp', to: '919876543210', type: 'template',
  template: { name, language: { code: 'en_US' },
    components: [{ type: 'body', parameters: params.map((text) => ({ type: 'text', text })) }] },
});
assert.deepEqual(templateParams(req('order_confirmed', ['Priya', '1001', '₹4,990'])), ['Priya', '1001', '₹4,990']);
assert.deepEqual(templateParams({ template: { components: [{ type: 'HEADER', parameters: [{ text: 'x' }] },
  { type: 'BODY', parameters: [{ type: 'text', text: 'A' }, { type: 'text', text: 7 }] }] } }), ['A', '7']);
assert.deepEqual(templateParams(JSON.stringify(req('cart_reminder', ['Priya']))), ['Priya']);
for (const bad of [null, undefined, {}, { template: {} }, { template: { components: [{ type: 'header' }] } }, 'not json', 5]) {
  assert.deepEqual(templateParams(bad), []);
}

const render = (name, params) => renderTemplate(name, templateParams(req(name, params)));
assert.equal(render('order_confirmed', ['Priya', '1001', '₹4,990']),
  "Hi Priya, thanks for your order 1001 with Mir Kash 💛 We've received it (total ₹4,990) and will pack it with care. We'll message you when it ships.");
assert.equal(render('order_shipped', ['Priya', '1001']),
  'Hi Priya, your Mir Kash order 1001 has shipped and is on its way. Thank you for choosing us 💛');
assert.equal(render('cod_confirmation', ['Priya', '1001', '₹4,990']),
  "Hi Priya, we've received your Cash-on-Delivery order #1001 (₹4,990).\n\nTo confirm, reply YES. If you didn't place this order, reply NO.");
assert.equal(render('order_shipped_v2', ['Priya', '1001', 'https://mirkash.in/orders/track']),
  'Good news, Priya — your order is on its way.\nOrder #1001 has shipped and should arrive within 5–7 business days.\n\n'
  + 'Track it here: https://mirkash.in/orders/track\n\nThank you for shopping with Mir Kash.');
assert.equal(render('order_cancelled', ['Priya', '1001', 'cancelled at your request', '5–7']),
  'Hi Priya, order #1001 has been cancelled.\nReason: cancelled at your request\n\n'
  + 'If you paid online, your refund will reflect within 5–7 business days.');
assert.equal(render('refund_processed', ['Priya', '1001', '₹4,990', '5–7']),
  'Hi Priya, your refund for order #1001 of ₹4,990 has been processed.\n\nIt should reflect in your account within 5–7 business days.');
assert.equal(render('cart_reminder', ['Priya']),
  'Hi Priya, you left something beautiful in your bag at Mir Kash. Complete your order here: https://mirkash.com/shop');
assert.equal(renderTemplate('hello_world', []), 'Hello World');
// A missing param leaves its {{n}} in place; a "$&" in a param is inserted literally.
assert.equal(renderTemplate('order_cancelled', ['Priya']).split('\n')[1], 'Reason: {{3}}');
assert.equal(renderTemplate('cart_reminder', ['$& $1']).slice(0, 9), 'Hi $& $1,');
// Unknown, null and empty names.
assert.equal(renderTemplate('welcome_back', ['Priya', '1001']), 'Template: welcome_back · Priya, 1001');
assert.equal(renderTemplate('welcome_back', []), 'Template: welcome_back');
assert.equal(renderTemplate('constructor', []), 'Template: constructor');
assert.equal(renderTemplate(null, ['x']), 'Template message');
assert.equal(renderTemplate('', []), 'Template message');

// ── the 24h reply window ────────────────────────────────────────────────────────
const ago = (ms) => new Date(NOW - ms).toISOString();
assert.equal(WINDOW_MS, 24 * 3600e3);
assert.equal(windowOpen(ago(23 * 3600e3 + 59 * 60e3), NOW), true);   // 23h59m
assert.equal(windowOpen(ago(24 * 3600e3 + 60e3), NOW), false);       // 24h01m
assert.equal(windowOpen(ago(WINDOW_MS), NOW), false);                // exactly 24h is closed
assert.equal(windowOpen(null, NOW), false);
assert.equal(windowOpen('garbage', NOW), false);
assert.equal(windowClosesAt('2026-10-21T09:30:00.000Z'), '2026-10-22T09:30:00.000Z');
assert.equal(windowClosesAt(null), null);
assert.equal(windowClosesAt('garbage'), null);

// ── tickFor precedence: failed > read > delivered > sent ────────────────────────
const t = (o) => tickFor({ send_status: 'sent', delivered_at: null, read_at: null, failed_at: null, ...o });
assert.equal(t({}), 'sent');
assert.equal(t({ send_status: null }), 'sent');
assert.equal(t({ delivered_at: ISO }), 'delivered');
assert.equal(t({ delivered_at: ISO, read_at: ISO }), 'read');
assert.equal(t({ read_at: ISO }), 'read');
assert.equal(t({ delivered_at: ISO, read_at: ISO, failed_at: ISO }), 'failed');
assert.equal(t({ send_status: 'failed', delivered_at: ISO, read_at: ISO }), 'failed');

// ── previewOf ───────────────────────────────────────────────────────────────────
assert.equal(previewOf('template', null, 'cart_reminder', req('cart_reminder', ['Priya'])),
  'Hi Priya, you left something beautiful in your bag at Mir Kash. Complete your order here: https://mirkash.com/shop');
assert.equal(previewOf('template', null, 'order_confirmed', req('order_confirmed', ['Priya', '1001', '₹4,990'])),
  "Hi Priya, thanks for your order 1001 with Mir Kash 💛 We've received it (total ₹4,990) and will pack it with care. We'll message you when it ships."
  .split(/(?:)/u).slice(0, 119).join('').trimEnd() + '…');
assert.equal(previewOf('template', null, 'mystery', null), 'Template: mystery');
assert.equal(previewOf('text', '  Hello\n\nthere\t  you ', null, null), 'Hello there you');
assert.equal(previewOf('text', null, null, null), '');
assert.equal(previewOf('button', 'YES', null, null), 'YES');
assert.equal(previewOf('image', null, null, null), '📷 Photo');
assert.equal(previewOf('image', 'This one', null, null), '📷 This one');
assert.equal(previewOf('video', null, null, null), '🎥 Video');
assert.equal(previewOf('video', 'Unboxing', null, null), '🎥 Unboxing');
assert.equal(previewOf('audio', null, null, null), '🎤 Voice message');
assert.equal(previewOf('document', 'invoice.pdf', null, null), '📄 invoice.pdf');
assert.equal(previewOf('document', null, null, null), '📄 Document');
assert.equal(previewOf('sticker', null, null, null), 'Sticker');
assert.equal(previewOf('location', 'Lal Chowk', null, null), '📍 Location');
assert.equal(previewOf('reaction', '❤️', null, null), 'Reacted ❤️');
assert.equal(previewOf('unsupported', null, null, null), 'Unsupported message');
// Truncation: at most 120 characters, ending in "…"; short text is untouched.
const long = previewOf('text', 'a'.repeat(300), null, null);
assert.equal(long.length, 120);
assert.ok(long.endsWith('…'));
assert.equal(previewOf('text', 'a'.repeat(120), null, null), 'a'.repeat(120));
// An emoji at the cut is never split in half.
const emo = Array.from(previewOf('text', '😀'.repeat(200), null, null));
assert.equal(emo.length, 120);
assert.equal(emo[118], '😀');

console.log('whatsapp-inbox: all checks passed');
