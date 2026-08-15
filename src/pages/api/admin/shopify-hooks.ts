import type { APIRoute } from 'astro';
import { runAdminQuery } from '~/lib/shopify/admin';

export const prerender = false;

// One-time setup: registers the Shopify webhooks this app needs on the INDIA store.
// Gated by CRON_SECRET (?key=<secret> or Authorization: Bearer <secret>). Idempotent —
// it lists existing subscriptions first and only creates the ones that are missing, so
// it's safe to hit repeatedly. Currently registers `orders/fulfilled` → instant
// "order shipped" WhatsApp (see /api/webhooks/shopify).
//
//   GET /api/admin/shopify-hooks?key=<CRON_SECRET>          → register (idempotent)
//   GET /api/admin/shopify-hooks?key=<CRON_SECRET>&list=1   → just list what's registered

const PROD_ORIGIN = 'https://www.mirkash.com';

// topic (Shopify enum) → the endpoint that handles it. Add more here as we grow.
const WANT: Array<{ topic: string }> = [{ topic: 'ORDERS_FULFILLED' }];

function callbackUrl(origin: string): string {
  return `${origin.replace(/\/$/, '')}/api/webhooks/shopify`;
}

interface HookNode {
  id: string;
  topic: string;
  endpoint: { __typename: string; callbackUrl?: string };
}

async function listHooks(): Promise<HookNode[]> {
  const data = await runAdminQuery<{ webhookSubscriptions: { edges: Array<{ node: HookNode }> } }>(
    `{ webhookSubscriptions(first: 100) {
        edges { node { id topic endpoint { __typename ... on WebhookHttpEndpoint { callbackUrl } } } }
    } }`,
  );
  return (data?.webhookSubscriptions?.edges ?? []).map((e) => e.node);
}

async function createHook(topic: string, url: string) {
  return runAdminQuery<{
    webhookSubscriptionCreate: {
      webhookSubscription: { id: string; topic: string } | null;
      userErrors: Array<{ field: string[]; message: string }>;
    };
  }>(
    `mutation($topic: WebhookSubscriptionTopic!, $sub: WebhookSubscriptionInput!) {
      webhookSubscriptionCreate(topic: $topic, webhookSubscription: $sub) {
        webhookSubscription { id topic }
        userErrors { field message }
      }
    }`,
    { topic, sub: { callbackUrl: url, format: 'JSON' } },
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
  const target = callbackUrl(origin);

  const existing = await listHooks();
  if (existing === null) return json({ ok: false, reason: 'admin API unavailable (check Shopify env)' }, 502);

  if (url.searchParams.get('list') === '1') {
    return json({ ok: true, target, subscriptions: existing });
  }

  const results: Array<{ topic: string; status: string; detail?: unknown }> = [];
  for (const want of WANT) {
    const already = existing.find(
      (h) => h.topic === want.topic && h.endpoint?.callbackUrl === target,
    );
    if (already) {
      results.push({ topic: want.topic, status: 'exists', detail: already.id });
      continue;
    }
    const res = await createHook(want.topic, target);
    const errs = res?.webhookSubscriptionCreate?.userErrors ?? [];
    if (res?.webhookSubscriptionCreate?.webhookSubscription) {
      results.push({ topic: want.topic, status: 'created', detail: res.webhookSubscriptionCreate.webhookSubscription.id });
    } else {
      results.push({ topic: want.topic, status: 'failed', detail: errs.length ? errs : 'unknown error' });
    }
  }

  return json({ ok: true, target, results });
};
