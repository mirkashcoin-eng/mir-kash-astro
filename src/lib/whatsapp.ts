// WhatsApp sending via the Meta Cloud API. Pre-approved templates only (business-
// initiated messages require them). Isolated + best-effort: never throws, so a
// messaging failure can never affect an order or a cron's other work.
import { adminDb } from './firebaseAdmin';

function env(k: string): string {
  if (typeof process !== 'undefined' && process.env && process.env[k]) return process.env[k] as string;
  const m = import.meta.env as Record<string, string | undefined>;
  return m[k] ?? '';
}

const GRAPH = 'https://graph.facebook.com/v21.0';

export function whatsappConfigured(): boolean {
  return Boolean(env('WHATSAPP_TOKEN') && env('WHATSAPP_PHONE_NUMBER_ID'));
}

// Meta wants country-code + number, digits only (e.g. 919876543210). A bare
// 10-digit Indian mobile is assumed +91.
export function waNumber(phone: string | null | undefined): string {
  let d = String(phone ?? '').replace(/[^0-9]/g, '');
  if (d.length === 10) d = '91' + d;
  return d;
}

// Send a pre-approved template. Returns true on success; logs and returns false on
// any failure. Never throws.
export async function sendTemplate(
  toPhone: string,
  template: string,
  bodyParams: string[] = [],
  langCode = 'en',
): Promise<boolean> {
  if (!whatsappConfigured()) return false;
  const to = waNumber(toPhone);
  if (to.length < 11) return false; // no usable number
  const body = {
    messaging_product: 'whatsapp',
    to,
    type: 'template',
    template: {
      name: template,
      language: { code: langCode },
      ...(bodyParams.length
        ? { components: [{ type: 'body', parameters: bodyParams.map((t) => ({ type: 'text', text: String(t) })) }] }
        : {}),
    },
  };
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 10000); // never stall a checkout on WhatsApp
  try {
    const res = await fetch(`${GRAPH}/${env('WHATSAPP_PHONE_NUMBER_ID')}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${env('WHATSAPP_TOKEN')}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      console.error('[whatsapp] send failed', res.status, (await res.text().catch(() => '')).slice(0, 500));
      return false;
    }
    return true;
  } catch (e) {
    console.error('[whatsapp] send error', e);
    return false;
  } finally {
    clearTimeout(t);
  }
}

// Fire the "order confirmed" WhatsApp for a just-completed order, immediately at
// checkout. Best-effort and de-duplicated (shares the `confirm:{orderName}` lock with
// the cron, so it's never sent twice). Safe to call from the payment path: returns
// straight away if not opted in / not configured, and never throws.
export async function notifyOrderConfirmed(o: {
  orderName: string | null;
  customerName: string | null;
  phone: string | null;
  total: { amount: string; currencyCode: string } | null;
  waOptin: boolean;
}): Promise<void> {
  if (!o.waOptin || !o.orderName || !o.phone || !whatsappConfigured()) return;
  const name = (o.customerName || 'there').trim().split(/\s+/)[0] || 'there';
  let amt = '';
  if (o.total) {
    const n = Math.round(Number(o.total.amount) || 0);
    try { amt = new Intl.NumberFormat('en-IN', { style: 'currency', currency: o.total.currencyCode || 'INR', maximumFractionDigits: 0 }).format(n); }
    catch { amt = `${o.total.currencyCode || 'INR'} ${n}`; }
  }
  try {
    await once(`confirm:${o.orderName}`, () => sendTemplate(o.phone!, 'order_confirmed', [name, o.orderName!, amt]));
  } catch { /* best-effort */ }
}

// Run `fn` at most once per `key`, ever, across cron re-runs. Claims an atomic lock
// (`wa_sent/{key}` via create(), which fails if it exists), runs, and RELEASES the
// lock if the send failed so a later run can retry. Returns whether a message went out.
export async function once(key: string, fn: () => Promise<boolean>): Promise<boolean> {
  const db = adminDb();
  if (!db) return false; // no store → can't dedupe → don't risk spamming
  const ref = db.collection('wa_sent').doc(key);
  try {
    await ref.create({ at: new Date().toISOString() });
  } catch {
    return false; // already claimed (or a write error) → treat as already handled
  }
  const ok = await fn();
  if (!ok) { try { await ref.delete(); } catch { /* leave the claim; a retry is harmless */ } }
  return ok;
}
