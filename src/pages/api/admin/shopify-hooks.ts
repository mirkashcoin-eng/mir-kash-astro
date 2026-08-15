import type { APIRoute } from 'astro';
import { runAdminQuery } from '~/lib/shopify/admin';

export const prerender = false;

// Clean-up utility for the Shopify webhook subscription this app briefly registered.
// WhatsApp order messages are owned by the separate Supabase `shopify-webhook` service,
// so this app must NOT receive order webhooks (it would double-message). This endpoint
// lists, and can DELETE, any subscription pointing at our own /api/webhooks/shopify.
// Gated by CRON_SECRET (?key=<secret> or Authorization: Bearer <secret>).
//
//   GET .../shopify-hooks?key=<CRON_SECRET>            → list our subscriptions
//   GET .../shopify-hooks?key=<CRON_SECRET>&delete=1   → delete the ones to our endpoint

const PROD_ORIGIN = 'https://www.mirkash.com';

interface HookNode {
  id: string;
  topic: string;
  endpoint: { __typename: string; callbackUrl?: string };
}

async function listHooks(): Promise<HookNode[] | null> {
  const data = await runAdminQuery<{ webhookSubscriptions: { edges: Array<{ node: HookNode }> } }>(
    `{ webhookSubscriptions(first: 100) {
        edges { node { id topic endpoint { __typename ... on WebhookHttpEndpoint { callbackUrl } } } }
    } }`,
  );
  if (!data) return null;
  return (data.webhookSubscriptions?.edges ?? []).map((e) => e.node);
}

async function deleteHook(id: string) {
  return runAdminQuery<{
    webhookSubscriptionDelete: { deletedWebhookSubscriptionId: string | null; userErrors: Array<{ message: string }> };
  }>(
    `mutation($id: ID!) { webhookSubscriptionDelete(id: $id) { deletedWebhookSubscriptionId userErrors { message } } }`,
    { id },
  );
}

const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj, null, 2), {
    status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

export const GET: APIRoute = async ({ request, url }) => {
  const secret = process.env.CRON_SECRET;
  const key = url.searchParams.get('key');
  const authed = secret && (key === secret || request.headers.get('authorization') === `Bearer ${secret}`);
  if (!secret || !authed) return new Response('unauthorized', { status: 401 });

  const origin =
    (process.env.PUBLIC_APP_ORIGIN || import.meta.env.PUBLIC_APP_ORIGIN || PROD_ORIGIN).replace(/\/$/, '');
  const target = `${origin}/api/webhooks/shopify`;

  const existing = await listHooks();
  if (existing === null) return json({ ok: false, reason: 'admin API unavailable (check Shopify env)' }, 502);

  const ours = existing.filter((h) => h.endpoint?.callbackUrl === target);

  if (url.searchParams.get('delete') !== '1') {
    return json({ ok: true, target, ours, all: existing });
  }

  const deleted: Array<{ id: string; topic: string; status: string }> = [];
  for (const h of ours) {
    const res = await deleteHook(h.id);
    const okId = res?.webhookSubscriptionDelete?.deletedWebhookSubscriptionId;
    deleted.push({ id: h.id, topic: h.topic, status: okId ? 'deleted' : 'failed' });
  }
  return json({ ok: true, target, deleted });
};
