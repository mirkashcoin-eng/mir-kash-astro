import type { APIRoute } from 'astro';
import { verifyFirebaseUser } from '~/lib/firebaseAuth';
import { q } from '~/lib/db';

export const prerender = false;

// The signed-in customer's saved delivery details (Neon `customer_profiles`, keyed by the
// Firebase uid in their ID token). Replaces the browser reading/writing Firestore directly:
// the token decides whose row it is, so nobody can read or change another customer's.
const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store' },
  });

const COLS = ['full_name', 'phone', 'address1', 'address2', 'city', 'province', 'zip', 'email'] as const;

async function who(request: Request) {
  const token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  return token ? verifyFirebaseUser(token) : null;
}

export const GET: APIRoute = async ({ request }) => {
  const user = await who(request);
  if (!user) return json({ error: 'Not signed in' }, 401);
  const rows = await q(`SELECT ${COLS.join(', ')} FROM customer_profiles WHERE uid = $1`, [user.uid]);
  if (!rows) return json({ error: 'Unavailable' }, 503);
  return json({ profile: rows[0] ? { id: user.uid, ...rows[0] } : null });
};

// Merge, like the old setDoc(..., { merge: true }): only fields sent are changed.
export const PUT: APIRoute = async ({ request }) => {
  const user = await who(request);
  if (!user) return json({ error: 'Not signed in' }, 401);
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return json({ error: 'Bad request' }, 400); }

  const sent = COLS.filter((c) => c in body);
  const val = (c: string) => {
    const v = body[c];
    return v == null ? null : String(v).trim().slice(0, 300) || null;
  };
  const cols = ['uid', ...sent];
  const params = [user.uid, ...sent.map(val)];
  const rows = await q(
    `INSERT INTO customer_profiles (${cols.join(', ')}) VALUES (${cols.map((_, i) => '$' + (i + 1)).join(', ')})
     ON CONFLICT (uid) DO UPDATE SET ${[...sent.map((c) => `${c} = EXCLUDED.${c}`), 'updated_at = now()'].join(', ')}
     RETURNING uid`,
    params,
  );
  return rows ? json({ ok: true }) : json({ error: 'Unavailable' }, 503);
};
