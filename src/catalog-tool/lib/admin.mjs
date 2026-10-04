// Shopify Admin API for both stores. Credentials come from the website's .env (never printed).
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './paths.mjs';

let env;
function readEnv() {
  if (env) return env;
  env = { ...process.env };
  try {
    for (const line of fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split('\n')) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m && !env[m[1]]) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
    }
  } catch { /* no .env: rely on process.env */ }
  return env;
}

let indiaToken = { value: '', expires: 0 };
async function credentials(store) {
  const e = readEnv();
  if (store === 'global') return { domain: e.SHOPIFY_GLOBAL_ADMIN_DOMAIN, token: e.SHOPIFY_GLOBAL_ADMIN_TOKEN };
  const domain = e.SHOPIFY_IN_ADMIN_DOMAIN || e.SHOPIFY_IN_DOMAIN;
  if (!indiaToken.value || Date.now() > indiaToken.expires) {
    const r = await fetch(`https://${domain}/admin/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: e.SHOPIFY_IN_ADMIN_CLIENT_ID, client_secret: e.SHOPIFY_IN_ADMIN_CLIENT_SECRET, grant_type: 'client_credentials' }),
    });
    const j = await r.json();
    if (!j.access_token) throw new Error(`India store login failed (${r.status})`);
    indiaToken = { value: j.access_token, expires: Date.now() + Math.max(60, (j.expires_in ?? 3600) - 300) * 1000 };
  }
  return { domain, token: indiaToken.value };
}

/** Runs one Admin GraphQL call and returns `data`; throws on transport or top-level GraphQL errors. */
export async function admin(store, query, variables = {}) {
  const { domain, token } = await credentials(store);
  if (!domain || !token) throw new Error(`Missing Shopify admin credentials for the ${store} store in .env`);
  const r = await fetch(`https://${domain}/admin/api/2025-01/graphql.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token },
    body: JSON.stringify({ query, variables }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.errors) throw new Error(`Shopify ${store} (${r.status}): ${JSON.stringify(j.errors ?? j).slice(0, 400)}`);
  return j.data;
}
