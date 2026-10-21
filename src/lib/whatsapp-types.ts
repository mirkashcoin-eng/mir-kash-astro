// Shared shapes for the WhatsApp inbox (/admin/whatsapp). This file is the contract
// between the Supabase store (whatsapp-store.ts), the pure helpers (whatsapp-inbox.ts),
// the Meta webhook, the admin API and the page. Change it only with all of them in view.
//
// Phones are always digits with the country code, no '+' (e.g. 919876543210) — what
// normalizePhone() in the Supabase service and waNumber() in whatsapp.ts produce, and
// what Meta sends as `from` / `recipient_id`.

export type WaDirection = 'out' | 'in';
export type WaKind =
  | 'template' | 'text' | 'image' | 'audio' | 'video' | 'document'
  | 'sticker' | 'location' | 'reaction' | 'button' | 'unsupported';
// order  = Supabase shopify-webhook (order confirmed / shipped / cancelled / refund)
// site   = this app's sendTemplate (cart_reminder cron, order_confirmed at checkout)
// inbox  = a founder's reply from /admin/whatsapp
// customer = an inbound message
export type WaSource = 'order' | 'site' | 'inbox' | 'customer';
export type WaTick = 'sent' | 'delivered' | 'read' | 'failed';

// ── Rows written to Supabase ────────────────────────────────────────────────────

// One outbound send → a messages_out row. The Supabase service writes its own rows
// (store_domain, event_key set; the new columns left at their defaults).
export interface WaOutRow {
  to_phone: string;
  template_name: string | null;   // null for a free-text inbox reply
  meta_message_id: string | null; // wamid; null when Meta rejected the send
  status: 'sent' | 'failed';
  request: unknown;               // the JSON body we POSTed to Meta
  response: unknown;              // Meta's JSON reply (or { error })
  phone_number_id: string | null; // which business number sent it
  source: Exclude<WaSource, 'customer'>;
  kind: 'template' | 'text';
  body: string | null;            // free-text body (inbox replies)
  sent_by: string | null;         // founder email (inbox replies)
  store_domain?: string | null;
  event_key?: string | null;
}

// One inbound customer message → a messages_in row (insert, ignore duplicates: Meta retries).
export interface WaInboundRow {
  meta_message_id: string;
  from_phone: string;
  phone_number_id: string | null; // the business number they wrote to
  kind: Exclude<WaKind, 'template'>;
  body: string | null;            // text, caption, button/list title, reaction emoji, "lat,lng"
  media_id: string | null;
  media_mime: string | null;
  reply_to: string | null;        // wamid of the message they quoted (context.id)
  received_at: string;            // ISO, from Meta's unix `timestamp`
  raw: unknown;                   // the single message object as Meta sent it
}

// A delivery receipt → upserted into message_status (keyed by wamid). Kept in its own
// table so a receipt can arrive before the messages_out row exists without ever
// colliding with the Supabase service's insert.
export interface WaStatusRow {
  meta_message_id: string;
  recipient_phone: string;
  phone_number_id: string | null;
  status: 'sent' | 'delivered' | 'read' | 'failed';
  at: string;                     // ISO
  error: string | null;           // Meta's error title/message for 'failed'
}

// A WhatsApp profile name from the webhook's `contacts` → upserted into wa_contacts.
export interface WaContactRow {
  phone: string;
  profile_name: string | null;
}

export interface ParsedWebhook {
  inbound: WaInboundRow[];
  statuses: WaStatusRow[];
  contacts: WaContactRow[];
}

// ── Rows read from the Supabase views ───────────────────────────────────────────

// One row of the wa_threads view: one per phone that has any message in or out.
export interface WaThreadRow {
  phone: string;
  profile_name: string | null;
  last_at: string;
  last_direction: WaDirection;
  last_kind: WaKind;
  last_body: string | null;
  last_template: string | null;
  last_request: unknown;          // messages_out.request of the last message when it was out, else null
  last_inbound_at: string | null;
  reply_number_id: string | null; // phone_number_id of their most recent inbound message
  unread: number;                 // inbound messages after wa_contacts.last_read_at
  total: number;                  // all messages in the thread
}

// One row of the wa_messages view: messages_out ∪ messages_in, with receipts joined.
export interface WaMessageRow {
  id: string;                     // meta_message_id, or 'out:<messages_out.id>' when there is none
  phone: string;
  direction: WaDirection;
  kind: WaKind;
  source: WaSource;
  template_name: string | null;
  request: unknown;               // out only
  body: string | null;
  media_id: string | null;
  media_mime: string | null;
  reply_to: string | null;
  sent_by: string | null;
  at: string;                     // created_at (out) / received_at (in)
  send_status: 'sent' | 'failed' | null; // messages_out.status (out only)
  send_error: unknown;            // messages_out.response when send_status = 'failed'
  delivered_at: string | null;
  read_at: string | null;
  failed_at: string | null;
  failed_reason: string | null;
}

// ── /api/admin/whatsapp response shapes (what the page consumes) ────────────────

export type WaFilter = 'all' | 'replied' | 'unread';

export interface WaThread {
  phone: string;
  name: string | null;            // WhatsApp profile name → People name → template first name
  person_id: string | null;       // open in /admin#people?id=… when known
  last_at: string;
  last_direction: WaDirection;
  last_preview: string;           // one line, already rendered (template text, "📷 Photo", …)
  last_inbound_at: string | null;
  unread: number;
  window_open: boolean;           // they wrote in the last 24h → free text allowed
}

export interface WaMessage {
  id: string;
  direction: WaDirection;
  kind: WaKind;
  source: WaSource;
  template: string | null;        // template name, for the "Template · name" chip
  text: string | null;            // what the customer saw / wrote, rendered
  media_id: string | null;        // fetch via GET /api/admin/whatsapp?view=media&id=…
  media_mime: string | null;
  reply_to: string | null;
  sent_by: string | null;
  at: string;
  tick: WaTick | null;            // out only
  failed_reason: string | null;
}

// GET /api/admin/whatsapp?view=threads&q=&filter=&before=
export interface WaThreadsResponse {
  configured: boolean;            // false → the page shows "not set up yet"
  as_of: string;
  threads: WaThread[];
  next_before: string | null;     // pass as ?before= for the next page (last_at of the last row)
}

// GET /api/admin/whatsapp?view=thread&phone=&before=   (also marks the thread read)
export interface WaThreadResponse {
  configured: boolean;
  phone: string;
  name: string | null;
  person_id: string | null;
  messages: WaMessage[];          // oldest first
  window_open: boolean;
  window_closes_at: string | null;
  last_inbound_at: string | null;
  next_before: string | null;     // older page cursor (`at` of the first message), null when none
}

// POST /api/admin/whatsapp  { phone, text }
export interface WaSendRequest { phone: string; text: string; }
export interface WaSendResponse {
  ok: boolean;
  message?: WaMessage;
  error?: string;                 // plain-English, shown under the composer
}
