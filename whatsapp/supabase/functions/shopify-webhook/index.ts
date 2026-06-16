// shopify-webhook — Phase 1 outbound notifications.
// Flow: identify store → verify Shopify HMAC → idempotency → map event→template →
//       consent + recipient → send the WhatsApp template via Meta → log → 200.
//
// Deploy WITHOUT JWT verification (Shopify can't send a Supabase token):
//   supabase functions deploy shopify-webhook --no-verify-jwt
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { detectEventKey, extractRecipient, formatMoney, hasOptIn, verifyShopifyHmac } from "../_shared/shopify.ts";
import { lookupOrder } from "../_shared/shopifyAdmin.ts";
import { sendTemplate } from "../_shared/meta.ts";

// Refund days shown in the cancel/refund messages (no per-order value from Shopify).
const REFUND_DAYS = "5–7";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const ok = (msg = "ok") => json(200, { ok: true, msg });
const bad = (status: number, error: string) => json(status, { ok: false, error });

Deno.serve(async (req) => {
  if (req.method !== "POST") return bad(405, "method not allowed");

  const raw = await req.text();
  const h = req.headers;
  const topic = h.get("x-shopify-topic") || "";
  const shopDomain = h.get("x-shopify-shop-domain") || "";
  const webhookId = h.get("x-shopify-webhook-id") || "";
  const hmac = h.get("x-shopify-hmac-sha256") || "";

  // 1) Identify the store from the shop domain.
  const { data: store } = await supabase
    .from("store_config").select("*")
    .eq("store_domain", shopDomain).eq("is_active", true).maybeSingle();
  if (!store) return bad(401, "unknown store");

  // 2) Verify the signature against the RAW body.
  if (!(await verifyShopifyHmac(raw, hmac, store.shopify_webhook_secret))) return bad(401, "bad signature");

  // 3) Record the event (idempotency on the Shopify webhook id).
  let payload: any;
  try {
    payload = JSON.parse(raw);
  } catch {
    return bad(400, "invalid json");
  }
  const orderId = String(payload?.id ?? payload?.order_id ?? "");
  const ins = await supabase
    .from("webhook_events")
    .insert({
      store_domain: shopDomain,
      topic,
      shopify_event_id: webhookId || crypto.randomUUID(),
      order_id: orderId,
      payload,
      status: "received",
    })
    .select("id").single();
  if (ins.error) {
    if ((ins.error as { code?: string }).code === "23505") return ok("duplicate"); // already processed
    // non-fatal: continue without an event row to update
  }
  const eventRowId = ins.data?.id as string | undefined;
  const finish = async (status: string, error?: string) => {
    if (eventRowId) {
      await supabase.from("webhook_events")
        .update({ status, error_message: error ?? null, processed_at: new Date().toISOString() })
        .eq("id", eventRowId);
    }
  };

  // 4) Map topic → event → approved template.
  const eventKey = detectEventKey(topic, payload);
  if (!eventKey) { await finish("skipped", "unhandled topic"); return ok("skipped"); }

  const { data: tmpl } = await supabase
    .from("template_map").select("*")
    .eq("store_domain", shopDomain).eq("event_key", eventKey).eq("is_active", true).maybeSingle();
  if (!tmpl) { await finish("skipped", `no template for ${eventKey}`); return ok("no template"); }

  // 5) Consent (when required) + recipient + per-event message variables.
  //    (The opt-in tag lives on the ORDER; the refund webhook has no tags, so the
  //    consent gate is only applied to order-type events.)
  if (store.require_optin && eventKey !== "refund_processed" && !hasOptIn(payload)) {
    await finish("skipped", "no opt-in"); return ok("no opt-in");
  }

  let toPhone: string;
  let bodyParams: string[];

  if (eventKey === "refund_processed") {
    // The refunds/create webhook lacks the phone + order number → look the order up.
    const look = await lookupOrder(payload?.order_id ?? "");
    if (!look?.phone) { await finish("skipped", "refund: no phone / admin creds"); return ok("refund skipped"); }
    const txns = Array.isArray(payload?.transactions) ? payload.transactions : [];
    const amount = formatMoney(
      txns.reduce((s: number, t: any) => s + (Number(t?.amount) || 0), 0),
      txns[0]?.currency || "INR",
    );
    toPhone = look.phone;
    bodyParams = [look.firstName, look.orderNum, amount, REFUND_DAYS]; // [name, order#, amount, days]
  } else {
    const r = extractRecipient(payload);
    if (!r.phone) { await finish("skipped", "no phone"); return ok("no phone"); }
    toPhone = r.phone;
    bodyParams =
      eventKey === "order_shipped" ? [r.name, r.orderNum, r.trackingUrl]
      : eventKey === "order_cancelled" ? [r.name, r.orderNum, r.reason, REFUND_DAYS]
      : [r.name, r.orderNum, r.total]; // order_confirmed | cod_confirmation
  }

  // 6) Send via Meta + log the result.
  const result = await sendTemplate({
    phoneNumberId: store.meta_phone_number_id,
    to: toPhone,
    templateName: tmpl.template_name,
    language: tmpl.language_code,
    bodyParams,
  });

  await supabase.from("messages_out").insert({
    store_domain: shopDomain,
    event_key: eventKey,
    to_phone: toPhone,
    template_name: tmpl.template_name,
    meta_message_id: result.messageId ?? null,
    status: result.ok ? "sent" : "failed",
    request: result.request,
    response: result.response,
  });

  await finish(result.ok ? "processed" : "error", result.ok ? undefined : `meta ${result.status}`);
  // Always 200 once recorded — failed sends are replayed from the logs, never via Shopify retries.
  return ok(result.ok ? "sent" : "send failed");
});
