// Pure helpers for the WhatsApp inbox: parse Meta's webhook, verify its signature,
// render a sent template as the customer saw it, the 24h reply window, ticks and
// one-line previews. No I/O, so it is unit-tested in whatsapp-inbox.test.mjs.
//
// STUB — implemented in ticket WA-2 (docs/whatsapp-inbox/tickets/WA-2-pure-helpers.md).
import type { ParsedWebhook, WaKind, WaTick } from './whatsapp-types';

export const WINDOW_MS = 24 * 3600e3;

// Body text of every template we send, {{n}} placeholders intact.
export const TEMPLATE_TEXT: Record<string, string> = {};

// Meta webhook body → rows to store. Ignores anything it doesn't recognise; never throws.
export function parseWebhook(_body: unknown): ParsedWebhook {
  return { inbound: [], statuses: [], contacts: [] };
}

// X-Hub-Signature-256 ("sha256=<hex>") over the RAW body with the Meta app secret.
// Web Crypto; constant-time compare. False on a missing header or secret.
export async function verifySignature(_rawBody: string, _header: string | null, _appSecret: string): Promise<boolean> {
  return false;
}

// The body-parameter texts from a messages_out.request JSON, in order.
export function templateParams(_request: unknown): string[] {
  return [];
}

// Template text with {{n}} filled in; unknown template → "Template: name · p1, p2".
export function renderTemplate(_name: string | null, _params: string[]): string {
  return '';
}

export function windowOpen(_lastInboundAt: string | null, _now: number = Date.now()): boolean {
  return false;
}

export function windowClosesAt(_lastInboundAt: string | null): string | null {
  return null;
}

// Outbound tick from the send result and receipts: failed > read > delivered > sent.
export function tickFor(_m: {
  send_status: 'sent' | 'failed' | null; delivered_at: string | null; read_at: string | null; failed_at: string | null;
}): WaTick {
  return 'sent';
}

// One-line preview for the thread list: template text, body, or "📷 Photo" etc.
export function previewOf(_kind: WaKind, _body: string | null, _template: string | null, _request: unknown): string {
  return '';
}
