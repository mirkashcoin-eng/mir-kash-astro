// Supabase backend (server-side only) — lead capture + (later) customer accounts.
// Uses the PostgREST REST API directly (no SDK dependency). Best-effort: if the
// project isn't configured yet, every call silently no-ops so checkout is never
// blocked. Activates once SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are set and the
// `checkout_leads` table exists:
//   create table checkout_leads (
//     id bigint generated always as identity primary key,
//     phone text, email text, source text,
//     created_at timestamptz default now()
//   );
function getEnv(key: string): string {
  if (typeof process !== 'undefined' && process.env && process.env[key]) {
    return process.env[key] as string;
  }
  const meta = import.meta.env as Record<string, string | undefined>;
  return meta[key] ?? '';
}

export function supabaseConfigured(): boolean {
  return Boolean(getEnv('SUPABASE_URL') && getEnv('SUPABASE_SERVICE_ROLE_KEY'));
}

async function insert(table: string, row: Record<string, unknown>): Promise<void> {
  const url = getEnv('SUPABASE_URL');
  const key = getEnv('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) return; // not configured yet → no-op
  try {
    const res = await fetch(`${url.replace(/\/$/, '')}/rest/v1/${table}`, {
      method: 'POST',
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify(row),
    });
    if (!res.ok) console.error(`[supabase] insert ${table} failed:`, res.status, await res.text());
  } catch (err) {
    console.error(`[supabase] insert ${table} error:`, err);
  }
}

// Verify a Supabase access token (from the browser account session) server-side
// and return the authenticated user's email — the only thing that unlocks their
// Shopify orders. Returns null if unconfigured or invalid.
export async function verifySupabaseUser(token: string): Promise<{ email: string } | null> {
  const url = getEnv('SUPABASE_URL');
  const key = getEnv('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key || !token) return null;
  try {
    const res = await fetch(`${url.replace(/\/$/, '')}/auth/v1/user`, {
      headers: { apikey: key, Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const user = (await res.json()) as { email?: string };
    return user.email ? { email: user.email } : null;
  } catch (err) {
    console.error('[supabase] verifyUser error:', err);
    return null;
  }
}

// Records that someone started checkout (clicked "Continue to Delivery").
export async function saveCheckoutLead(data: { phone: string; email?: string | null; source?: string }): Promise<void> {
  await insert('checkout_leads', {
    phone: data.phone,
    email: data.email ?? null,
    source: data.source ?? 'india-checkout',
  });
}
