// wa-cart-reminder — abandoned-cart WhatsApp reminder (the cart_reminder template).
//
// Runs on a schedule (pg_cron → this URL, gated by RETRY_SECRET). Finds open checkout drafts
// on the India store that opted in to WhatsApp, are 2h–7d old and were created after
// wa_settings.cart_reminder_from, and sends each ONE reminder — ever, via the cart_reminders
// lock. A failed send releases its lock so the next run retries it.
//
// ?dry=1 reports what it would send without sending or locking anything.
//
// Deploy:   supabase functions deploy wa-cart-reminder --no-verify-jwt
// Secrets:  RETRY_SECRET, META_ACCESS_TOKEN, SHOPIFY_IN_ADMIN_DOMAIN / _CLIENT_ID / _CLIENT_SECRET
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { listOpenDrafts, adminConfigured } from "../_shared/shopifyAdmin.ts";
import { sendTemplate } from "../_shared/meta.ts";

const HOUR = 3600e3;
const MIN_AGE = 2 * HOUR;       // give an abandoner time to come back on their own
const MAX_AGE = 7 * 24 * HOUR;  // …but don't nag weeks later
const MAX_PER_RUN = 25;

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPA_SERVICE_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

Deno.serve(async (req) => {
  const secret = Deno.env.get("RETRY_SECRET");
  const url = new URL(req.url);
  const key = url.searchParams.get("key");
  const authed = secret && (key === secret || req.headers.get("authorization") === `Bearer ${secret}`);
  if (!secret || !authed) return json(401, { ok: false, error: "unauthorized" });
  const dry = url.searchParams.get("dry") === "1";

  if (!adminConfigured()) return json(200, { ok: false, reason: "SHOPIFY_IN_ADMIN_* secrets are not set" });

  const { data: store } = await supabase
    .from("store_config").select("store_domain, meta_phone_number_id")
    .eq("is_active", true).limit(1).maybeSingle();
  if (!store) return json(200, { ok: false, reason: "no active store_config row" });

  const { data: tmpl } = await supabase
    .from("template_map").select("template_name, language_code")
    .eq("store_domain", store.store_domain).eq("event_key", "cart_reminder").eq("is_active", true).maybeSingle();
  if (!tmpl) return json(200, { ok: false, reason: "no active cart_reminder template_map row" });

  const { data: setting } = await supabase.from("wa_settings").select("value").eq("key", "cart_reminder_from").maybeSingle();
  const from = Date.parse(setting?.value ?? "");
  if (!Number.isFinite(from)) return json(200, { ok: false, reason: "wa_settings.cart_reminder_from is missing" });

  const drafts = await listOpenDrafts();
  if (!drafts) return json(502, { ok: false, reason: "couldn't read drafts from Shopify" });

  const now = Date.now();
  const candidates = drafts.filter((d) => {
    const age = now - Date.parse(d.createdAt);
    return d.tags.includes("wa-optin") && !!d.phone && age >= MIN_AGE && age <= MAX_AGE && Date.parse(d.createdAt) >= from;
  });

  // Already reminded?
  const { data: done } = await supabase.from("cart_reminders").select("draft_id")
    .in("draft_id", candidates.map((d) => d.id));
  const sentIds = new Set((done ?? []).map((r: { draft_id: string }) => r.draft_id));
  const todo = candidates.filter((d) => !sentIds.has(d.id)).slice(0, MAX_PER_RUN);

  if (dry) {
    return json(200, { ok: true, dry: true, scanned: drafts.length, eligible: candidates.length, alreadySent: sentIds.size, wouldSend: todo.length });
  }

  const sent: string[] = [];
  let failed = 0;
  for (const d of todo) {
    // Claim first (primary key → only one run can win), release if the send fails.
    const claim = await supabase.from("cart_reminders")
      .insert({ draft_id: d.id, store_domain: store.store_domain, to_phone: d.phone });
    if (claim.error) continue; // already claimed (or a write error) → don't risk a double send

    const result = await sendTemplate({
      phoneNumberId: store.meta_phone_number_id,
      to: d.phone!,
      templateName: tmpl.template_name,
      language: tmpl.language_code,
      bodyParams: [d.firstName],
    });
    await supabase.from("messages_out").insert({
      store_domain: store.store_domain,
      event_key: "cart_reminder",
      to_phone: d.phone,
      template_name: tmpl.template_name,
      meta_message_id: result.messageId ?? null,
      status: result.ok ? "sent" : "failed",
      request: result.request,
      response: result.response,
      phone_number_id: store.meta_phone_number_id,
      source: "order",
      kind: "template",
    });
    if (result.ok) sent.push(d.name);
    else {
      failed++;
      await supabase.from("cart_reminders").delete().eq("draft_id", d.id);
    }
  }
  return json(200, { ok: true, scanned: drafts.length, eligible: candidates.length, sent: sent.length, failed });
});
