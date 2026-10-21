// SAMPLE DATA for reviewing /admin/whatsapp before the WhatsApp inbox is set up. Only
// used behind ?demo=1, and the page labels it "Sample data". These are not real customers.
//
// Built in the API's own shapes (src/lib/whatsapp-types.ts), and served through small
// fake versions of the API calls below, so demo mode runs exactly the rendering code
// real mode runs. Times are relative to page load, so "Today" and the 24-hour reply
// window always look right.
import type {
  WaFilter, WaMessage, WaSendResponse, WaThread, WaThreadResponse, WaThreadsResponse, WaTick,
} from '~/lib/whatsapp-types';

// Body texts as approved by Meta (whatsapp/templates/TEMPLATES.md, plus cart_reminder
// from src/pages/api/admin/wa-setup.ts).
const TEMPLATE_TEXT: Record<string, string> = {
  order_confirmed: "Hi {{1}}, your Mir Kash order is confirmed.\nOrder #{{2}} — {{3}}\n\nWe're getting it ready with care. You'll hear from us again the moment it ships.",
  cod_confirmation: "Hi {{1}}, we've received your Cash-on-Delivery order #{{2}} ({{3}}).\n\nTo confirm, reply YES. If you didn't place this order, reply NO.",
  order_shipped: 'Good news, {{1}} — your order is on its way.\nOrder #{{2}} has shipped and should arrive within 5–7 business days.\n\nTrack it here: {{3}}\n\nThank you for shopping with Mir Kash.',
  order_cancelled: 'Hi {{1}}, order #{{2}} has been cancelled.\nReason: {{3}}\n\nIf you paid online, your refund will reflect within {{4}} business days.',
  refund_processed: 'Hi {{1}}, your refund for order #{{2}} of {{3}} has been processed.\n\nIt should reflect in your account within {{4}} business days.',
  cart_reminder: 'Hi {{1}}, you left something beautiful in your bag at Mir Kash. Complete your order here: https://mirkash.com/shop',
};
const fill = (name: string, p: string[]): string =>
  (TEMPLATE_TEXT[name] || 'Template: ' + name).replace(/\{\{(\d+)\}\}/g, (_, n) => p[Number(n) - 1] ?? '');

const LOADED = Date.now();
const MIN = 60e3, H = 60, D = 1440;
const at = (minAgo: number) => new Date(LOADED - minAgo * MIN).toISOString();
const WINDOW_MS = 24 * 3600e3;
const FOUNDER = 'dishant@mirkash.com';

interface Conv { phone: string; name: string | null; person_id: string | null; unread: number; messages: WaMessage[]; }

let seq = 0;
const base = (o: Partial<WaMessage> & Pick<WaMessage, 'direction' | 'kind' | 'source' | 'at'>): WaMessage => ({
  id: 'wamid.demo' + ++seq, template: null, text: null, media_id: null, media_mime: null,
  reply_to: null, sent_by: null, tick: null, failed_reason: null, ...o,
});

// Little builder so each conversation reads like a script.
function conv(phone: string, name: string | null, person_id: string | null, unread: number,
  script: (b: {
    tpl: (minAgo: number, name: string, params: string[], tick?: WaTick, source?: 'order' | 'site', failed?: string) => void;
    us: (minAgo: number, text: string, tick?: WaTick) => void;
    them: (minAgo: number, text: string | null, more?: Partial<WaMessage>) => void;
  }) => void): Conv {
  const messages: WaMessage[] = [];
  script({
    tpl: (m, name, params, tick = 'read', source = 'order', failed) => messages.push(base({
      direction: 'out', kind: 'template', source, at: at(m), template: name, text: fill(name, params), tick,
      failed_reason: tick === 'failed' ? failed || null : null,
    })),
    us: (m, text, tick = 'read') => messages.push(base({ direction: 'out', kind: 'text', source: 'inbox', at: at(m), text, tick, sent_by: FOUNDER })),
    them: (m, text, more = {}) => messages.push(base({ direction: 'in', kind: 'text', source: 'customer', at: at(m), text, ...more })),
  });
  messages.sort((a, b) => a.at.localeCompare(b.at));
  return { phone, name, person_id, unread, messages };
}

const photo = (caption: string | null): Partial<WaMessage> => ({ kind: 'image', text: caption, media_id: 'demo-photo-' + ++seq, media_mime: 'image/jpeg' });

// ── The conversations ────────────────────────────────────────────────────────
const CONVS: Conv[] = [
  // Order confirmed, then shipped. No reply.
  conv('919876543210', 'Priya Sharma', 'p_priya', 0, (b) => {
    b.tpl(4 * D + 3 * H, 'order_confirmed', ['Priya', '1041', '₹4,990']);
    b.tpl(2 * D + 5 * H, 'order_shipped', ['Priya', '1041', 'https://mirkash.com/orders/track']);
  }),
  // COD confirmation answered YES with the button; window open, we've replied.
  conv('919820012345', 'Ananya Iyer', 'p_ananya', 0, (b) => {
    b.tpl(3 * H + 12, 'cod_confirmation', ['Ananya', '1049', '₹3,490']);
    b.them(2 * H + 40, 'YES', { kind: 'button' });
    b.us(2 * H + 31, 'Thank you, Ananya. Your order is confirmed and will ship tomorrow. Please keep ₹3,490 ready for the courier.', 'read');
  }),
  // A reply with a photo, unread.
  conv('919811198765', 'Meera Kapoor', 'p_meera', 1, (b) => {
    b.tpl(6 * D, 'order_confirmed', ['Meera', '1032', '₹6,490']);
    b.tpl(5 * D + 2 * H, 'order_shipped', ['Meera', '1032', 'https://mirkash.com/orders/track']);
    b.them(3 * H + 5, null, photo("Received it today. It's even prettier in person!"));
  }),
  // A failed send.
  conv('917045123456', 'Rohan Mehta', 'p_rohan', 0, (b) => {
    b.tpl(26 * H, 'order_confirmed', ['Rohan', '1046', '₹2,990'], 'failed', 'site', 'This phone number is not on WhatsApp (131026)');
  }),
  // Unread questions, window open.
  conv('919900112233', 'Kavya Reddy', 'p_kavya', 2, (b) => {
    b.tpl(20 * H, 'order_confirmed', ['Kavya', '1047', '₹5,290'], 'delivered', 'site');
    b.them(52, 'Hi, can I change the delivery address to my office? It’s in Bandra Kurla Complex.');
    b.them(49, 'Order 1047. I can send the full address here.');
  }),
  // Cancelled, asked about the refund, refunded. Their last message is old: window closed.
  conv('919769554433', 'Sneha Patil', 'p_sneha', 0, (b) => {
    b.tpl(10 * D, 'order_cancelled', ['Sneha', '1021', 'cancelled at your request', '5–7']);
    b.them(9 * D + 6 * H, 'Okay. When will the refund come? I paid by UPI.');
    b.us(9 * D + 5 * H, 'Hi Sneha, UPI refunds usually reach your account within 5–7 business days. We’ll message you the moment it’s processed.');
    b.them(9 * D + 4 * H, 'Thanks 🙏');
    b.tpl(6 * D, 'refund_processed', ['Sneha', '1021', '₹3,990', '5–7']);
  }),
  // Cart reminders only, no reply.
  conv('919833445566', 'Aditi', null, 0, (b) => { b.tpl(22 * H, 'cart_reminder', ['Aditi'], 'delivered', 'site'); }),
  conv('918879001122', null, null, 0, (b) => { b.tpl(2 * D + 4 * H, 'cart_reminder', ['there'], 'read', 'site'); }),
  conv('919167223344', 'Nisha Agarwal', 'p_nisha', 0, (b) => { b.tpl(6 * D + 2 * H, 'cart_reminder', ['Nisha'], 'sent', 'site'); }),
  // Refunded long ago, thanked us: window closed.
  conv('919322110099', 'Tanvi Desai', 'p_tanvi', 0, (b) => {
    b.tpl(23 * D, 'refund_processed', ['Tanvi', '1008', '₹4,490', '5–7'], 'delivered');
    b.them(22 * D + 20 * H, 'Got it, thank you for sorting this out so quickly.');
  }),
  // Wrote in first, no order. Unread, window open.
  conv('919867009988', null, null, 1, (b) => {
    b.them(19 * H, 'Hello, do you ship to Kochi? And is the Tote available in tan?');
  }),
  // Just confirmed, only "sent" so far.
  conv('919702334455', 'Zoya Khan', 'p_zoya', 0, (b) => {
    b.tpl(11, 'order_confirmed', ['Zoya', '1053', '₹7,980'], 'sent', 'site');
  }),
  // COD answered NO; we replied. Window open.
  conv('919819887766', 'Riya Joshi', 'p_riya', 0, (b) => {
    b.tpl(7 * H, 'cod_confirmation', ['Riya', '1050', '₹2,490'], 'read');
    b.them(6 * H + 30, 'NO', { kind: 'button' });
    b.them(6 * H + 29, 'Sorry, my mother placed this by mistake on my phone.');
    b.us(6 * H + 2, 'No problem at all, Riya. We’ve cancelled order 1050, so nothing will be delivered.', 'delivered');
  }),
  // One long conversation (48 messages) for scrolling and "Load earlier".
  conv('919004567890', 'Isha Malhotra', 'p_isha', 2, (b) => {
    const lines: Array<['us' | 'them' | 'tpl' | 'audio' | 'photo', string, string[]?]> = [
      ['them', 'Hi! I saw the Rust Tote on Instagram. Is it still available?'],
      ['us', 'Hello Isha, thank you for writing in. Yes, the Rust Tote is in stock right now.'],
      ['them', "Lovely. What is it made of? I don't buy leather."],
      ['us', "It's apple leather, made from waste from the apple-juice industry. No animal leather anywhere in it."],
      ['them', "That's amazing. How big is it? Will a 13 inch laptop fit?"],
      ['us', 'Yes, a 13-inch laptop fits comfortably. It’s 38 cm wide, 30 cm tall and 12 cm deep.'],
      ['them', 'And the handle drop?'],
      ['us', 'The handles have a 24 cm drop, so it sits nicely on the shoulder.'],
      ['them', 'Perfect. Do you have it in black too?'],
      ['us', 'Black is being made right now and should be back in about 3 weeks. Rust and Tan are ready to ship.'],
      ['them', 'Hmm, let me think about the colour.'],
      ['them', 'Can you show me the tan in daylight?'],
      ['us', 'Of course. The product page has a daylight photo of the Tan:\nhttps://mirkash.com/products/tote-tan'],
      ['them', "Oh that's gorgeous"],
      ['them', "I'll take the tan one"],
      ['us', 'Wonderful choice. It ships within 2 days of your order.'],
      ['tpl', 'order_confirmed', ['Isha', '1038', '₹6,490']],
      ['them', 'Done! Just placed it 🙂'],
      ['us', 'Thank you, Isha. We’ll keep you posted.'],
      ['them', "Is gift wrapping possible? It's for my sister's birthday."],
      ['us', 'Yes, we’ll wrap it in our cotton dust bag and a gift box at no charge. Would you like a note inside?'],
      ['them', "Yes please. 'Happy birthday Tara, love always, Isha'"],
      ['us', 'Noted, exactly as you wrote it.'],
      ['them', 'Thank you so much'],
      ['tpl', 'order_shipped', ['Isha', '1038', 'https://mirkash.com/orders/track']],
      ['them', 'Got the tracking link, thanks'],
      ['them', 'It says arriving Thursday. Her birthday is Friday so that works'],
      ['us', 'Lovely, that gives you a day to spare.'],
      ['audio', ''],
      ['us', 'Thank you for the voice note! So glad Tara loved it.'],
      ['them', 'She really did. She wants the crossbody now 😄'],
      ['us', 'That’s the best compliment. The Velvet Crossbody is in stock in Bottle Green and Midnight.'],
      ['them', 'Midnight is the dark blue one?'],
      ['us', 'Yes, a deep navy velvet with gold-tone hardware.'],
      ['them', 'Is velvet hard to care for?'],
      ['us', 'Not really. Brush it gently with a soft cloth and keep it out of the rain. Every bag comes with a care card.'],
      ['them', 'Okay. Any offers going on?'],
      ['us', 'Nothing running right now, but shipping is always free within India.'],
      ['them', 'Fair enough'],
      ['photo', 'This is how she styled the tote'],
      ['us', 'That looks beautiful. May we share it on our page, without her name?'],
      ['them', 'Let me ask her'],
      ['them', 'She says yes!'],
      ['us', 'Thank you both. We’ll post it with just the Mir Kash tag.'],
      ['them', "Also can I see the crossbody in person? I'm in Andheri."],
      ['us', 'Yes, Try at Home is available in Mumbai. We bring a few bags to you, with no obligation to buy. Shall I set it up?'],
      ['them', 'Yes, Saturday afternoon if possible'],
      ['them', 'Around 4?'],
    ];
    // Spread from 19 days ago to 5 hours ago, in uneven bursts like a real chat.
    const start = 19 * D, end = 5 * H;
    lines.forEach(([who, text, params], i) => {
      const f = i / (lines.length - 1);
      const m = Math.round(start - (start - end) * Math.pow(f, 0.8)) - (i % 3);
      if (who === 'us') b.us(m, text, 'read');
      else if (who === 'them') b.them(m, text);
      else if (who === 'tpl') b.tpl(m, text, params || [], 'read');
      else if (who === 'audio') b.them(m, null, { kind: 'audio', media_id: 'demo-voice-' + i, media_mime: 'audio/ogg' });
      else b.them(m, text, photo(text));
    });
  }),
  // A sticker and a reaction.
  conv('919930556677', 'Farah Shaikh', 'p_farah', 0, (b) => {
    b.tpl(3 * D, 'order_shipped', ['Farah', '1044', 'https://mirkash.com/orders/track']);
    b.them(2 * D + 20 * H, null, { kind: 'sticker', media_id: 'demo-sticker-1', media_mime: 'image/webp' });
    b.them(2 * D + 19 * H, '❤️', { kind: 'reaction' });
  }),
];

// ── One-line previews, the way the API renders them ──────────────────────────
function preview(m: WaMessage): string {
  const one = (s: string | null) => (s || '').replace(/\s+/g, ' ').trim();
  if (m.kind === 'image') return '📷 ' + (one(m.text) || 'Photo');
  if (m.kind === 'sticker') return 'Sticker';
  if (m.kind === 'audio') return '🎤 Voice message';
  if (m.kind === 'reaction') return 'Reacted ' + one(m.text);
  return one(m.text);
}
const lastIn = (c: Conv) => [...c.messages].reverse().find((m) => m.direction === 'in') || null;
const isOpen = (iso: string | null, now = Date.now()) => !!iso && now - new Date(iso).getTime() < WINDOW_MS;

function threadOf(c: Conv): WaThread {
  const last = c.messages[c.messages.length - 1];
  const li = lastIn(c);
  return {
    phone: c.phone, name: c.name, person_id: c.person_id, last_at: last.at, last_direction: last.direction,
    last_preview: preview(last), last_inbound_at: li ? li.at : null, unread: c.unread, window_open: isOpen(li ? li.at : null),
  };
}

// ── Fake API ─────────────────────────────────────────────────────────────────
const THREAD_PAGE = 8;     // small, so "load more" on scroll is exercised
const MESSAGE_PAGE = 30;   // smaller than the long thread, so "Load earlier" shows

export function demoThreads(o: { q: string; filter: WaFilter; before: string | null }): WaThreadsResponse {
  const q = o.q.trim().toLowerCase();
  const digits = q.replace(/\D/g, '');
  let rows = CONVS.map(threadOf).sort((a, b) => b.last_at.localeCompare(a.last_at));
  if (o.filter === 'replied') rows = rows.filter((t) => t.last_inbound_at);
  if (o.filter === 'unread') rows = rows.filter((t) => t.unread > 0);
  if (q) rows = rows.filter((t) => (t.name || '').toLowerCase().includes(q) || (digits.length >= 3 && t.phone.includes(digits)) || t.last_preview.toLowerCase().includes(q));
  if (o.before) rows = rows.filter((t) => t.last_at < o.before!);
  const page = rows.slice(0, THREAD_PAGE);
  return { configured: true, as_of: new Date().toISOString(), threads: page, next_before: rows.length > THREAD_PAGE ? page[page.length - 1].last_at : null };
}

export function demoThread(phone: string, before: string | null): WaThreadResponse {
  const c = CONVS.find((x) => x.phone === phone);
  if (!c) return { configured: true, phone, name: null, person_id: null, messages: [], window_open: false, window_closes_at: null, last_inbound_at: null, next_before: null };
  c.unread = 0;   // opening a conversation marks it read, like the real API
  const older = before ? c.messages.filter((m) => m.at < before) : c.messages;
  const page = older.slice(-MESSAGE_PAGE);
  const li = lastIn(c);
  const open = isOpen(li ? li.at : null);
  return {
    configured: true, phone, name: c.name, person_id: c.person_id, messages: page,
    window_open: open, window_closes_at: open && li ? new Date(new Date(li.at).getTime() + WINDOW_MS).toISOString() : null,
    last_inbound_at: li ? li.at : null, next_before: older.length > page.length ? page[0].at : null,
  };
}

/** Fakes Meta accepting the message after 600ms. A text containing "#fail" fails, to review the error state. */
export function demoSend(phone: string, text: string): Promise<WaSendResponse> {
  return new Promise((res) => setTimeout(() => {
    const c = CONVS.find((x) => x.phone === phone);
    const li = c ? lastIn(c) : null;
    if (!c || !isOpen(li ? li.at : null)) return res({ ok: false, error: 'They haven’t written in the last 24 hours, so WhatsApp won’t allow a free-text reply.' });
    if (/#fail/i.test(text)) return res({ ok: false, error: 'WhatsApp didn’t accept the message (sample error).' });
    const message = base({ direction: 'out', kind: 'text', source: 'inbox', at: new Date().toISOString(), text, tick: 'sent', sent_by: FOUNDER });
    c.messages.push(message);
    res({ ok: true, message });
  }, 600));
}

/** A small inline SVG standing in for a customer's photo; two seconds of silence for a voice note. */
export function demoMediaUrl(id: string, kind: string): string {
  if (kind === 'audio') return silentWav();
  const sticker = kind === 'sticker' || id.indexOf('sticker') >= 0;
  const svg = sticker
    ? '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160" viewBox="0 0 160 160"><circle cx="80" cy="80" r="70" fill="#f1ece4"/><path d="M52 100c8 12 48 12 56 0" stroke="#2c1a0e" stroke-width="7" fill="none" stroke-linecap="round"/><circle cx="58" cy="66" r="8" fill="#2c1a0e"/><circle cx="102" cy="66" r="8" fill="#2c1a0e"/></svg>'
    : '<svg xmlns="http://www.w3.org/2000/svg" width="480" height="360" viewBox="0 0 480 360"><rect width="480" height="360" fill="#e9dfd2"/><path d="M170 140c0-40 140-40 140 0" stroke="#6b4a2f" stroke-width="12" fill="none"/><rect x="130" y="140" width="220" height="160" rx="18" fill="#8a5a3c"/><rect x="130" y="140" width="220" height="30" rx="10" fill="#6b4a2f"/><text x="240" y="336" text-anchor="middle" font-family="sans-serif" font-size="18" fill="#5f5a53">Sample photo</text></svg>';
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}

let WAV = '';
function silentWav(): string {
  if (WAV) return WAV;
  const rate = 8000, n = rate * 2;
  const buf = new ArrayBuffer(44 + n);
  const v = new DataView(buf);
  const str = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + n, true); str(8, 'WAVE'); str(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate, true); v.setUint16(32, 1, true); v.setUint16(34, 8, true);
  str(36, 'data'); v.setUint32(40, n, true);
  for (let i = 0; i < n; i++) v.setUint8(44 + i, 128);
  WAV = URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
  return WAV;
}
