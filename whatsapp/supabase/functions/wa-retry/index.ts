// wa-retry — drains the failed-send queue.
//
// shopify-webhook records every event in `webhook_events` and tries to send immediately.
// If Meta is momentarily down / rate-limits, that send fails and the row is left
// status='error' — and nothing ever tries again. THIS worker is the missing piece: on a
// schedule it re-attempts those failed events (up to MAX_ATTEMPTS), so a transient outage
// never silently drops a customer's message. That's what turns the durable log into a
// real queue.
//
// Add-only by design: it reuses the SAME _shared helpers + template_map as the webhook and
// never touches the live webhook path. It reads the store + payload straight from the
// queue row, so it needs no Shopify signature.
//
// Deploy:   supabase functions deploy wa-retry --no-verify-jwt
// Secret:   supabase secrets set RETRY_SECRET=<a-random-string>
// Schedule: point any scheduler (Supabase cron / cron-job.org) every ~10 min at
//           https://<project-ref>.supabase.co/functions/v1/wa-retry?key=<RETRY_SECRET>
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { detectEventKey, extractRecipient, formatMoney, hasOptIn } from "../_shared/shopify.ts";
import { lookupOrder } from "../_shared/shopifyAdmin.ts";
import { sendTemplate } from "../_shared/meta.ts";

const MAX_ATTEMPTS = 5;                       // give up after this many tries (poison-message guard)
const WINDOW_MS = 3 * 24 * 60 * 60 * 1000;    // ignore failures older than 3 days
const BATCH = 25;                             // rows processed per run
const REFUND_DAYS = "5–7";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPA_SERVICE_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

// Re-attempt ONE stored event. Mirrors the send half of shopify-webhook (map event →
// template → consent → recipient → send → log), reading everything from the queue row.
// Returns the new status the row should carry: processed | skipped | error.
async function retryEvent(ev: any): Promise<{ status: "processed" | "skipped" | "error"; error?: string }> {
  const { data: store } = await supabase
    .from("store_config").select("*")
    .eq("store_domain", ev.store_domain).eq("is_active", true).maybeSingle();
  if (!store) return { status: "error", error: "unknown store" };

  const payload = ev.payload;
  const eventKey = detectEventKey(ev.topic, payload);
  if (!eventKey) return { status: "skipped", error: "unhandled topic" };

  const { data: tmpl } = await supabase
    .from("template_map").select("*")
    .eq("store_domain", ev.store_domain).eq("event_key", eventKey).eq("is_active", true).maybeSingle();
  if (!tmpl) return { status: "skipped", error: `no template for ${eventKey}` };

  // Consent gate — same rule as the webhook (skipped, not retried, when absent).
  if (store.require_optin && eventKey !== "refund_processed" && !hasOptIn(payload)) {
    return { status: "skipped", error: "no opt-in" };
  }

  let toPhone: string;
  let bodyParams: string[];

  if (eventKey === "refund_processed") {
    const look = await lookupOrder(payload?.order_id ?? "");
    if (!look?.phone) return { status: "skipped", error: "refund: no phone / admin creds" };
    const txns = Array.isArray(payload?.transactions) ? payload.transactions : [];
    const amount = formatMoney(
      txns.reduce((s: number, t: any) => s + (Number(t?.amount) || 0), 0),
      txns[0]?.currency || "INR",
    );
    toPhone = look.phone;
    bodyParams = [look.firstName, look.orderNum, amount, REFUND_DAYS];
  } else {
    const r = extractRecipient(payload);
    if (!r.phone) return { status: "skipped", error: "no phone" };
    toPhone = r.phone;
    bodyParams =
      eventKey === "order_shipped" ? [r.name, r.orderNum, r.trackingUrl]
      : eventKey === "order_cancelled" ? [r.name, r.orderNum, r.reason, REFUND_DAYS]
      : [r.name, r.orderNum, r.total];
  }

  if (tmpl.template_name === "hello_world") bodyParams = [];

  const result = await sendTemplate({
    phoneNumberId: store.meta_phone_number_id,
    to: toPhone,
    templateName: tmpl.template_name,
    language: tmpl.language_code,
    bodyParams,
  });

  await supabase.from("messages_out").insert({
    store_domain: ev.store_domain,
    event_key: eventKey,
    to_phone: toPhone,
    template_name: tmpl.template_name,
    meta_message_id: result.messageId ?? null,
    status: result.ok ? "sent" : "failed",
    request: result.request,
    response: result.response,
  });

  return result.ok ? { status: "processed" } : { status: "error", error: `meta ${result.status}` };
}

Deno.serve(async (req) => {
  // Scheduler-only endpoint — gate on a shared secret (query ?key= or Bearer).
  const secret = Deno.env.get("RETRY_SECRET");
  const url = new URL(req.url);
  const key = url.searchParams.get("key");
  const authed = secret && (key === secret || req.headers.get("authorization") === `Bearer ${secret}`);
  if (!secret || !authed) return json(401, { ok: false, error: "unauthorized" });

  const sinceIso = new Date(Date.now() - WINDOW_MS).toISOString();
  const { data: rows, error } = await supabase
    .from("webhook_events")
    .select("id, store_domain, topic, payload, retry_count")
    .eq("status", "error")
    .lt("retry_count", MAX_ATTEMPTS)
    .gte("received_at", sinceIso)
    .order("received_at", { ascending: true })
    .limit(BATCH);
  if (error) return json(500, { ok: false, error: error.message });

  const summary = { scanned: rows?.length ?? 0, processed: 0, skipped: 0, stillFailing: 0 };

  for (const ev of rows ?? []) {
    let res: { status: "processed" | "skipped" | "error"; error?: string };
    try {
      res = await retryEvent(ev);
    } catch (e) {
      res = { status: "error", error: String(e) };
    }
    if (res.status === "processed") summary.processed++;
    else if (res.status === "skipped") summary.skipped++;
    else summary.stillFailing++;

    // 'processed'/'skipped' leave the error queue; 'error' stays queued until MAX_ATTEMPTS.
    await supabase.from("webhook_events").update({
      status: res.status,
      error_message: res.error ?? null,
      retry_count: (ev.retry_count ?? 0) + 1,
      processed_at: new Date().toISOString(),
    }).eq("id", ev.id);
  }

  return json(200, { ok: true, ...summary });
});
